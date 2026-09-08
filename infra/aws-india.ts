import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const cfg = new pulumi.Config();
const domain      = cfg.get("domain")      ?? "arhamworkspace.tech";
const dbPassword  = cfg.requireSecret("dbPassword");
const keyPairName = cfg.get("keyPairName") ?? "arham-key";
// Where CloudWatch alarm notifications go. Set with:
//   pulumi config set arham-infra:alertEmail ops@example.com
// If unset, the SNS topic is still created (alarms have somewhere to publish)
// but no email subscription is made — set it and re-run to start getting pages.
const alertEmail  = cfg.get("alertEmail");

// Operator CIDR(s) allowed to reach SSH on the mail instance. Comma-separated,
// e.g. "203.0.113.4/32,198.51.100.0/28". Set with:
//   pulumi config set arham-infra:sshAllowedCidr 203.0.113.4/32
//
// If it is UNSET, port 22 is not opened at all. The stack still deploys and mail
// still works; you simply cannot SSH in until you set the key and re-run
// `pulumi up`. That is deliberate — 22 open to 0.0.0.0/0 on a public mail server
// is found by scanners within minutes, so "closed" is the safe default and
// "world-open" is never one. Recover a lost CIDR with EC2 Instance Connect or by
// setting the key and re-running; it is a 30-second fix.
const sshAllowedCidrs = (cfg.get("sshAllowedCidr") ?? "")
  .split(",")
  .map((c) => c.trim())
  .filter((c) => c.length > 0);

for (const c of sshAllowedCidrs) {
  if (c === "0.0.0.0/0" || c === "::/0") {
    throw new Error(
      `arham-infra:sshAllowedCidr contains "${c}" — world-open SSH is exactly the ` +
      "bug this config key exists to prevent. Use your office/VPN egress address " +
      "as a /32 (curl ifconfig.me).",
    );
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(c)) {
    throw new Error(
      `arham-infra:sshAllowedCidr entry "${c}" is not an IPv4 CIDR. ` +
      'Expected something like "203.0.113.4/32".',
    );
  }
}

// Where SES bounce/complaint notifications are POSTed. The console app serves
// this route; another moving part owns its implementation, this stack only has
// to point SNS at it. Override if the console ever moves off console.<domain>.
const sesEventsEndpoint = cfg.get("sesEventsEndpoint")
  ?? `https://console.${domain}/api/ses/notifications`;

// Suffix for the RDS final-snapshot name. Regenerated per `pulumi up`, which
// guarantees uniqueness across destroy/recreate cycles. It is never sent to the
// RDS API (it is only used at delete time), so the diff it shows is a no-op.
const finalSnapshotStamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

export class ArhamAwsIndiaStack extends pulumi.ComponentResource {
  public readonly mailElasticIp:   pulumi.Output<string>;
  public readonly dbEndpoint:      pulumi.Output<string>;
  /** Bare hostname (no ":5432"), for anything that needs a Postgres host. */
  public readonly dbAddress:       pulumi.Output<string>;
  public readonly s3BlobBucket:    pulumi.Output<string>;
  public readonly sesSmtpUser:     pulumi.Output<string>;
  public readonly sesSmtpPassword: pulumi.Output<string>;
  public readonly sesDkimTokens:   pulumi.Output<string[]>;
  public readonly alertsTopicArn:  pulumi.Output<string>;
  /** SNS topic SES publishes bounces + complaints to. Consumer: console /api/ses/notifications. */
  public readonly sesEventsTopicArn:      pulumi.Output<string>;
  public readonly sesConfigurationSet:    pulumi.Output<string>;
  /** HTTPS endpoint SNS delivers those events to (subscription starts Pending). */
  public readonly sesEventsEndpoint:      pulumi.Output<string>;
  public readonly sesEventsSubscriptionArn: pulumi.Output<string>;

  constructor(name: string) {
    super("arham:stack:AwsIndia", name);
    const opts = { parent: this };

    // VPC — no NAT gateway (DB in private subnet is reachable from EC2 via VPC
    // internal routing without NAT; DB doesn't need internet access itself)
    const vpc = new awsx.ec2.Vpc("arham-vpc", {
      cidrBlock: "10.0.0.0/16",
      numberOfAvailabilityZones: 2,
      natGateways: { strategy: "None" },  // saves $32/mo vs managed NAT GW
      tags: { Name: "arham-vpc", Project: "arham-mail" },
    }, opts);

    // ─── Security Groups ──────────────────────────────────────────────────────

    const mailSg = new aws.ec2.SecurityGroup("mail-sg", {
      vpcId: vpc.vpcId,
      description: "Stalwart mail server - all mail ports + web",
      ingress: [
        // SSH — operator CIDRs only. Absent entirely when arham-infra:sshAllowedCidr
        // is unset (see the warning logged below).
        ...(sshAllowedCidrs.length > 0
          ? [{
              protocol: "tcp", fromPort: 22, toPort: 22,
              cidrBlocks: sshAllowedCidrs,
              description: "SSH (operator CIDRs only - arham-infra:sshAllowedCidr)",
            }]
          : []),
        // Public mail + web. These MUST stay open to the world: 25 is inbound
        // internet mail, 465/587 are client submission, 993 is IMAP over TLS,
        // 80 is the ACME HTTP-01 challenge, 443 is JMAP/webmail/console.
        { protocol: "tcp", fromPort: 25,  toPort: 25,  cidrBlocks: ["0.0.0.0/0"], description: "SMTP" },
        { protocol: "tcp", fromPort: 465, toPort: 465, cidrBlocks: ["0.0.0.0/0"], description: "SMTPS" },
        { protocol: "tcp", fromPort: 587, toPort: 587, cidrBlocks: ["0.0.0.0/0"], description: "Submission (STARTTLS)" },
        { protocol: "tcp", fromPort: 993, toPort: 993, cidrBlocks: ["0.0.0.0/0"], description: "IMAPS (implicit TLS)" },
        { protocol: "tcp", fromPort: 80,  toPort: 80,  cidrBlocks: ["0.0.0.0/0"], description: "HTTP / ACME" },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"], description: "HTTPS" },

        // NO port 143. Cleartext IMAP is deliberately not reachable from the
        // internet. Every mail client a customer of ours actually uses reaches
        // IMAP on 993 with implicit TLS — Thunderbird, Outlook, Apple Mail and
        // both mobile OSes autoconfigure to 993, and the providers we migrate
        // people off (Google Workspace, Zoho) publish 993 only, so nobody
        // arrives here with a 143-shaped client. Leaving 143 open buys nothing
        // and costs a STARTTLS-stripping downgrade path to plaintext logins.
        // configure-stalwart.sh still binds a 143 listener on 127.0.0.1 for
        // on-box smoke tests, with plaintext auth refused.
      ],
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      tags: { Name: "arham-mail-sg" },
    }, opts);

    if (sshAllowedCidrs.length === 0) {
      pulumi.log.warn(
        "arham-infra:sshAllowedCidr is not set — port 22 is CLOSED on the mail " +
        "security group and you will not be able to SSH to the instance. Run: " +
        "pulumi config set arham-infra:sshAllowedCidr \"$(curl -s ifconfig.me)/32\" " +
        "&& pulumi up",
      );
    }

    // DB SG — only mail EC2 can connect
    const dbSg = new aws.ec2.SecurityGroup("db-sg", {
      vpcId: vpc.vpcId,
      description: "RDS PostgreSQL - internal only",
      ingress: [
        { protocol: "tcp", fromPort: 5432, toPort: 5432, securityGroups: [mailSg.id], description: "Postgres from mail EC2" },
      ],
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      tags: { Name: "arham-db-sg" },
    }, opts);

    // NOTE: no ACM certificate here. Nothing in this stack terminates TLS at an
    // AWS-managed endpoint (the ALB/CloudFront that used to are gone) — Stalwart
    // obtains and renews its own certs over ACME/Let's Encrypt on the instance.

    // ─── EC2 — Graviton2 ARM64 (t4g.medium: 2 vCPU / 4 GB, burstable ~$25/mo) ─
    // Burstable: sustained CPU above the 20%/vCPU baseline drains CPU credits and
    // then throttles, so the CPUCreditBalance alarm below is not optional.
    // PINNED, deliberately. This was `getAmiOutput({ mostRecent: true })`, which
    // re-resolves on every preview — so the moment Amazon published a newer
    // AL2023 image, Pulumi wanted a different AMI, and an AMI change FORCES
    // REPLACEMENT of the instance. On a live mail server that destroys the disk:
    // Stalwart's config.toml, the certbot TLS material, the DKIM private key,
    // the Redis sidecar and every PM2 app. Mail down, and outbound failing DKIM
    // until a new key is published in DNS.
    //
    // Pin it to what is actually running. Moving to a newer AMI is a deliberate
    // rebuild (snapshot, launch, restore config and DKIM, reassociate the EIP),
    // never a side effect of running `pulumi up` for an unrelated change.
    const stalwartAmiId = cfg.get("amiId") ?? "ami-002fc85c039f93d93";

    // Runs once on first boot — installs Stalwart + nginx + Redis sidecar
    const userData = `#!/bin/bash
set -e
exec > /var/log/arham-setup.log 2>&1

# System
dnf update -y
dnf install -y nginx certbot python3-certbot-nginx wget tar curl redis6 \\
               git rsync jq gcc-c++ make

# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
npm install -g pm2

# 2 GB swap. \`next build\` for the console and the webui peaks well above what is
# left of this box's 4 GB once Stalwart and Postgres client buffers are resident,
# and an OOM kill during a deploy takes stalwart-mail down with it.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# Redis sidecar (replaces ElastiCache — saves $12/mo, fine at this scale)
systemctl enable redis6 && systemctl start redis6

# Stalwart official ARM64 binary
STALWART_VER="v0.16.19"
curl -fsSL -o /tmp/stalwart.tar.gz \\
  "https://github.com/stalwartlabs/mail-server/releases/download/\${STALWART_VER}/stalwart-aarch64-unknown-linux-musl.tar.gz"
cd /tmp && tar -xzf stalwart.tar.gz && chmod +x stalwart
mv stalwart /usr/local/bin/stalwart-mail

mkdir -p /var/lib/stalwart-mail /etc/stalwart-mail
useradd -r -s /bin/false stalwart 2>/dev/null || true
chown stalwart:stalwart /var/lib/stalwart-mail

cat > /etc/systemd/system/stalwart-mail.service << 'SVCEOF'
[Unit]
Description=Stalwart Mail Server
After=network.target redis6.service

[Service]
Type=simple
User=stalwart
ExecStart=/usr/local/bin/stalwart-mail --config /etc/stalwart-mail/config.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable stalwart-mail

# PM2 boot integration for the three Node apps (console, webui, migration
# workers). deploy-apps.sh installs them; this only makes them survive a reboot.
pm2 startup systemd -u ec2-user --hp /home/ec2-user
mkdir -p /home/ec2-user/apps /var/log/arham
chown -R ec2-user:ec2-user /home/ec2-user/apps /var/log/arham

# This box runs the mail server AND the product. Bootstrap installs neither
# config nor applications — both are pushed from the repo, in this order:
echo "Bootstrap complete."
echo "Next, from the repo checkout on your laptop:"
echo "  1. scp infra/scripts/configure-stalwart.sh up and run it ON this box"
echo "     (writes /etc/stalwart-mail/config.toml + all nginx vhosts, starts Stalwart)"
echo "  2. bash infra/scripts/deploy-apps.sh   (runs LOCALLY; installs and starts"
echo "     arham-console, arham-webui and the migration workers under PM2)"
echo "See infra/MIGRATION.md - 'Configure Server' and 'Deploy the applications'."
`;

    // IAM role for EC2 → S3 access (Stalwart blob store)
    const ec2Role = new aws.iam.Role("stalwart-ec2-role", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" }],
      }),
      tags: { Project: "arham-mail" },
    }, opts);

    new aws.iam.RolePolicy("stalwart-s3-policy", {
      role: ec2Role.name,
      policy: pulumi.interpolate`{
        "Version": "2012-10-17",
        "Statement": [{
          "Effect": "Allow",
          "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket"],
          "Resource": ["arn:aws:s3:::arham-mail-blobs-in","arn:aws:s3:::arham-mail-blobs-in/*"]
        }]
      }`,
    }, opts);

    // Customer-domain SES onboarding. This is a multi-tenant platform: when a
    // customer adds a domain in the console we must register it with SES and read
    // back its Easy-DKIM tokens, otherwise SES rejects their mail with
    // "Email address is not verified" and nothing they send ever leaves.
    // Doing that by hand per domain does not scale, so the console needs these at
    // runtime. Scoped to identity lifecycle + read-back only — no sending policy,
    // no account-level mutation.
    new aws.iam.RolePolicy("stalwart-ses-identity-policy", {
      role: ec2Role.name,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: [
            "ses:CreateEmailIdentity",
            "ses:DeleteEmailIdentity",
            "ses:GetEmailIdentity",
            "ses:ListEmailIdentities",
            "ses:PutEmailIdentityDkimAttributes",
            "ses:PutEmailIdentityMailFromAttributes",
            // Lets the console show whether the account is still sandboxed,
            // which changes what we tell the customer to expect.
            "ses:GetAccount",
          ],
          Resource: "*",
        }],
      }),
    }, opts);

    // SSM Session Manager — shell access with no SSH port and no IP allowlist.
    //
    // sshAllowedCidr pins port 22 to one address, but this operator is on Airtel
    // residential broadband: the IP rotated twice in a week, and each rotation
    // locks everyone out until someone runs `pulumi config set` + `pulumi up`.
    // That is a bad dependency for the only shell into a production mail server.
    //
    // Attaching the managed policy to the EXISTING role is deliberate: it changes
    // the role, not the instance, so it cannot trigger the stop/start cycle that
    // took production down on 2026-09-01. The agent ships with AL2023 and picks
    // up the new permissions without a reboot.
    //
    //   aws ssm start-session --target <instance-id> --region ap-south-1
    new aws.iam.RolePolicyAttachment("stalwart-ssm-policy", {
      role: ec2Role.name,
      policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
    }, opts);

    const ec2InstanceProfile = new aws.iam.InstanceProfile("stalwart-profile", {
      role: ec2Role.name,
    }, opts);

    const mailServer = new aws.ec2.Instance("stalwart", {
      // m6g.medium, not t4g.medium. On 2026-09-01 a `pulumi up` stopped this
      // instance to apply a userData change and AWS then refused to start it:
      // InsufficientInstanceCapacity in ap-south-1a, for t4g.medium AND t4g.large.
      // Production was down until the type was switched to m6g.medium, which AWS
      // accepted. Do NOT revert this to a t4g type without first confirming capacity
      // in the AZ — reverting recreates that outage, because the volume is pinned to
      // ap-south-1a and cannot simply move.
      //
      // m6g is also non-burstable: no CPU credits to exhaust, which suits a mail
      // server under sustained load better than t4g did. Same 4 GB RAM, 1 vCPU
      // instead of 2, ~$28/mo vs ~$25.
      instanceType: "m6g.medium",
      ami: stalwartAmiId,
      subnetId: vpc.publicSubnetIds[0],
      vpcSecurityGroupIds: [mailSg.id],
      keyName: keyPairName,
      rootBlockDevice: {
        volumeType: "gp3",
        volumeSize: 40,    // OS + logs; mail blobs go to S3
        encrypted: true,
      },
      userData: userData,
      iamInstanceProfile: ec2InstanceProfile.name,
      tags: { Name: "arham-stalwart-in", Project: "arham-mail", Backup: "daily" },
    }, opts);

    // Static IP — survives reboots, reassignable on instance replacement
    const eip = new aws.ec2.Eip("stalwart-eip", {
      instance: mailServer.id,
      tags: { Name: "arham-mail-ip" },
    }, opts);

    // ─── RDS PostgreSQL t4g.micro ($15/mo — replaces Aurora at $43/mo) ───────
    const dbSubnetGroup = new aws.rds.SubnetGroup("arham-db-subnets", {
      subnetIds: vpc.privateSubnetIds,   // private — not internet-reachable
      tags: { Name: "arham-db-subnet-group" },
    }, opts);

    const db = new aws.rds.Instance("arham-db", {
      identifier:              "arham-mail-db",
      engine:                  "postgres",
      engineVersion:           "15",
      instanceClass:           "db.t4g.micro",   // Graviton ARM — cheapest managed PG
      allocatedStorage:        20,
      maxAllocatedStorage:     100,   // storage autoscaling — a full volume makes RDS read-only (mail stops)
      storageType:             "gp3",
      dbName:                  "arham",
      username:                "arhamapp",
      password:                dbPassword,
      dbSubnetGroupName:       dbSubnetGroup.name,
      vpcSecurityGroupIds:     [dbSg.id],
      publiclyAccessible:      false,
      storageEncrypted:        true,

      // Backups. This DB holds mailbox metadata, folder trees, the user directory
      // and the FTS index — the S3 blobs are unreadable without it. Retention > 0
      // is also what enables point-in-time recovery.
      backupRetentionPeriod:   14,
      deleteAutomatedBackups:  false,  // keep snapshots if the instance is deleted
      copyTagsToSnapshot:      true,
      // UTC windows chosen for IST off-hours (IST = UTC+5:30):
      backupWindow:            "19:30-20:30",           // 01:00-02:00 IST
      maintenanceWindow:       "sun:20:45-sun:21:45",   // Mon 02:15-03:15 IST
      // NOTE: db.t4g.micro does not support Performance Insights — leave it off.

      skipFinalSnapshot:       false,
      // Fixed names collide on a second destroy/recreate cycle; stamp it so every
      // deploy carries a fresh, unique final-snapshot name.
      finalSnapshotIdentifier: `arham-mail-db-final-${pulumi.getStack()}-${finalSnapshotStamp}`,
      tags: { Project: "arham-mail" },
    }, opts);

    // ─── S3 — mail blobs (bodies + attachments, India data residency) ─────────
    const mailBlobsBucket = new aws.s3.Bucket("mail-blobs", {
      bucket: "arham-mail-blobs-in",
      tags: { Project: "arham-mail", DataClass: "mail-content" },
    }, opts);
    new aws.s3.BucketVersioningV2("mail-blobs-versioning", {
      bucket: mailBlobsBucket.id,
      versioningConfiguration: { status: "Enabled" },
    }, opts);
    new aws.s3.BucketServerSideEncryptionConfigurationV2("mail-blobs-sse", {
      bucket: mailBlobsBucket.id,
      rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
    }, opts);

    // Public access block. Account-level BPA has defaulted to on since April 2023,
    // so this is very probably already closed — but this bucket holds customers'
    // raw mail, and "probably closed, inherited from a setting anyone with billing
    // access can flip" is not a control. Pin it on the bucket itself.
    new aws.s3.BucketPublicAccessBlock("mail-blobs-bpa", {
      bucket:                mailBlobsBucket.id,
      blockPublicAcls:       true,
      blockPublicPolicy:     true,
      ignorePublicAcls:      true,
      restrictPublicBuckets: true,
    }, opts);

    // Lifecycle. Versioning is on (above) as ransomware/oops protection, which
    // means every overwritten blob and every "deleted" blob is retained and
    // billed forever: deleting a mailbox currently *increases* the bill for the
    // rest of time. Expire noncurrent versions after 60 days — long enough to
    // undo a bad delete or a bad deploy, short enough that storage stops being a
    // ratchet. Delete markers left behind with no versions under them are swept
    // too, and half-finished multipart uploads (large attachments over a flaky
    // link) are aborted after 7 days rather than billing as invisible parts.
    new aws.s3.BucketLifecycleConfigurationV2("mail-blobs-lifecycle", {
      bucket: mailBlobsBucket.id,
      rules: [{
        id:     "expire-noncurrent-and-abort-mpu",
        status: "Enabled",
        filter: {},   // whole bucket
        noncurrentVersionExpiration:   { noncurrentDays: 60 },
        abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
        // Only removes markers that have no noncurrent versions left under them,
        // i.e. after the rule above has already expired them.
        expiration: { expiredObjectDeleteMarker: true },
      }],
    }, opts);

    // ─── SES — outbound relay + DKIM ─────────────────────────────────────────
    const sesDomain = new aws.ses.DomainIdentity("arham-ses-domain", {
      domain: domain,
    }, opts);

    // DKIM tokens — add as 3 CNAME records in your DNS after deploy
    const sesDkim = new aws.ses.DomainDkim("arham-ses-dkim", {
      domain: sesDomain.domain,
    }, opts);

    // IAM user for SES SMTP — credentials go into Stalwart config
    const sesUser = new aws.iam.User("ses-smtp-user", {
      name: "arham-ses-smtp",
      tags: { Project: "arham-mail" },
    }, opts);
    new aws.iam.UserPolicy("ses-smtp-policy", {
      user: sesUser.name,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: ["ses:SendRawEmail"], Resource: "*" }],
      }),
    }, opts);
    const sesAccessKey = new aws.iam.AccessKey("ses-smtp-key", {
      user: sesUser.name,
    }, opts);

    // ─── SES bounce / complaint feedback ─────────────────────────────────────
    // The production-access request tells AWS we handle bounces and complaints
    // "automatically via SNS notifications". This is where that stops being a
    // promise. Ignoring bounces is also how a sending domain gets throttled and
    // then suspended: SES enforces a bounce rate under 5% and a complaint rate
    // under 0.1%, measured across the whole account.
    //
    // Topic name is fixed (not Pulumi-suffixed) because the console app's
    // consumer and the runbook both refer to it by name.
    const sesEventsTopic = new aws.sns.Topic("arham-ses-events", {
      name: "arham-ses-events",
      tags: { Project: "arham-mail" },
    }, opts);

    // SES will not accept a destination it cannot publish to, so the topic policy
    // has to exist first. Scope it to this account so another account cannot use
    // our topic as a bounce-injection endpoint. Account id is lifted off the
    // topic ARN rather than a getCallerIdentity call — same answer, one fewer
    // API round trip during preview.
    const sesEventsTopicPolicy = new aws.sns.TopicPolicy("arham-ses-events-policy", {
      arn:    sesEventsTopic.arn,
      policy: pulumi.all([sesEventsTopic.arn]).apply(([topicArn]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Sid:       "AllowSESPublish",
          Effect:    "Allow",
          Principal: { Service: "ses.amazonaws.com" },
          Action:    "SNS:Publish",
          Resource:  topicArn,
          Condition: { StringEquals: { "AWS:SourceAccount": topicArn.split(":")[4] } },
        }],
      })),
    }, opts);

    // Configuration set — the reputation/event grouping SES hangs metrics off.
    const sesConfigSet = new aws.ses.ConfigurationSet("arham-ses-config-set", {
      name:                     "arham-mail-events",
      reputationMetricsEnabled: true,   // per-config-set bounce/complaint CloudWatch metrics
    }, opts);

    // Event destination: bounces and complaints only. Deliveries and opens are
    // high-volume noise that would hammer the console endpoint for no decision.
    // (If you later want "reject" — SES refusing a message for virus/content —
    // add it here AND teach the consumer that eventType, do not add it blind.)
    new aws.ses.EventDestination("arham-ses-bounce-complaint", {
      name:                 "bounce-complaint-to-sns",
      configurationSetName: sesConfigSet.name,
      enabled:              true,
      matchingTypes:        ["bounce", "complaint"],
      snsDestination:       { topicArn: sesEventsTopic.arn },
    }, opts);

    // IMPORTANT — a configuration set only sees mail that is *tagged* with it.
    // Stalwart relays through the SES SMTP endpoint and does not add an
    // X-SES-CONFIGURATION-SET header, so the event destination above would sit
    // silent forever on its own. These identity-level feedback topics are what
    // actually deliver bounces and complaints for everything we send, headers or
    // not. Both are wired to the same topic on purpose.
    //
    // NOTE FOR THE CONSUMER: the two paths have DIFFERENT payload shapes.
    //   - identity feedback  → { "notificationType": "Bounce" | "Complaint", ... }
    //   - config-set events  → { "eventType":        "Bounce" | "Complaint", ... }
    // /api/ses/notifications must handle both, plus SNS "SubscriptionConfirmation".
    const sesBounceTopic = new aws.ses.IdentityNotificationTopic("arham-ses-bounces", {
      identity:              sesDomain.domain,
      notificationType:      "Bounce",
      topicArn:              sesEventsTopic.arn,
      includeOriginalHeaders: true,
    }, { ...opts, dependsOn: [sesEventsTopicPolicy] });

    const sesComplaintTopic = new aws.ses.IdentityNotificationTopic("arham-ses-complaints", {
      identity:              sesDomain.domain,
      notificationType:      "Complaint",
      topicArn:              sesEventsTopic.arn,
      includeOriginalHeaders: true,
    }, { ...opts, dependsOn: [sesEventsTopicPolicy] });

    // HTTPS delivery to the console endpoint.
    //
    // This subscription is created in "PendingConfirmation" and STAYS there until
    // the endpoint answers SNS's SubscriptionConfirmation POST. On the first
    // `pulumi up` that cannot happen: console.<domain> does not resolve to this
    // instance until DNS cutover and has no real certificate until certbot runs.
    // That is expected and is not a failure — after cutover, either hit "Request
    // confirmation" on the subscription in the SNS console, or delete the
    // subscription and re-run `pulumi up`. MIGRATION.md carries the step.
    //
    // endpointAutoConfirms is deliberately left off: turning it on makes Pulumi
    // block waiting for a confirmation that cannot arrive yet, which would fail
    // the whole deploy.
    const sesEventsSubscription = new aws.sns.TopicSubscription("arham-ses-events-https", {
      topic:    sesEventsTopic.arn,
      protocol: "https",
      endpoint: sesEventsEndpoint,
    }, { ...opts, dependsOn: [sesBounceTopic, sesComplaintTopic] });

    // FOLLOW-UP (not implemented here, deliberately): per-tenant configuration
    // sets. Today every customer shares one SES reputation, so one tenant
    // importing a stale 2018 contact list can bounce the whole platform into a
    // sending pause. Isolating that means a configuration set per tenant, a
    // dedicated IP pool for the noisy ones, and Stalwart stamping
    // X-SES-CONFIGURATION-SET per sending domain — which is an application
    // change (per-domain send path + provisioning), not an infra one, and needs
    // the per-tenant reputation surfaced in the console. Half-doing it here
    // (config sets nothing tags mail with) would just add resources that report
    // zeros. Track it as its own piece of work.

    // ─── Monitoring — SNS alert topic + CloudWatch alarms ────────────────────
    const alertsTopic = new aws.sns.Topic("arham-alerts", {
      name: "arham-mail-alerts",
      tags: { Project: "arham-mail" },
    }, opts);

    if (alertEmail) {
      // AWS emails a confirmation link; the subscription stays "pending" until
      // someone clicks it (Pulumi cannot confirm it for you).
      new aws.sns.TopicSubscription("arham-alerts-email", {
        topic:    alertsTopic.arn,
        protocol: "email",
        endpoint: alertEmail,
      }, opts);
    } else {
      pulumi.log.warn(
        "arham-infra:alertEmail is not set — CloudWatch alarms will fire into an " +
        "SNS topic with no subscribers. Run: pulumi config set arham-infra:alertEmail <you@example.com>",
      );
    }

    const alarmActions = [alertsTopic.arn];
    const dbDims  = { DBInstanceIdentifier: db.identifier };
    const ec2Dims = { InstanceId: mailServer.id };

    // RDS — free storage. 20 GB allocated (autoscaling to 100); page at 4 GiB left.
    new aws.cloudwatch.MetricAlarm("rds-free-storage-low", {
      name:               "arham-rds-free-storage-low",
      alarmDescription:   "RDS free storage below 4 GiB — mail metadata writes will fail when it hits 0",
      namespace:          "AWS/RDS",
      metricName:         "FreeStorageSpace",
      dimensions:         dbDims,
      statistic:          "Average",
      period:             300,
      evaluationPeriods:  2,
      comparisonOperator: "LessThanThreshold",
      threshold:          4 * 1024 * 1024 * 1024,
      treatMissingData:   "breaching",
      alarmActions,
      okActions: alarmActions,
      tags: { Project: "arham-mail" },
    }, opts);

    // RDS — CPU.
    new aws.cloudwatch.MetricAlarm("rds-cpu-high", {
      name:               "arham-rds-cpu-high",
      alarmDescription:   "RDS CPU above 80% for 15 minutes",
      namespace:          "AWS/RDS",
      metricName:         "CPUUtilization",
      dimensions:         dbDims,
      statistic:          "Average",
      period:             300,
      evaluationPeriods:  3,
      comparisonOperator: "GreaterThanThreshold",
      threshold:          80,
      treatMissingData:   "missing",
      alarmActions,
      okActions: alarmActions,
      tags: { Project: "arham-mail" },
    }, opts);

    // RDS — connection count. db.t4g.micro tops out near ~110 connections.
    new aws.cloudwatch.MetricAlarm("rds-connections-high", {
      name:               "arham-rds-connections-high",
      alarmDescription:   "RDS connection count above 80 — approaching the db.t4g.micro ceiling",
      namespace:          "AWS/RDS",
      metricName:         "DatabaseConnections",
      dimensions:         dbDims,
      statistic:          "Average",
      period:             300,
      evaluationPeriods:  2,
      comparisonOperator: "GreaterThanThreshold",
      threshold:          80,
      treatMissingData:   "missing",
      alarmActions,
      okActions: alarmActions,
      tags: { Project: "arham-mail" },
    }, opts);

    // EC2 — burst credits. On t4g, an exhausted balance throttles the instance to
    // its 20%/vCPU baseline, which shows up as slow/queued mail delivery.
    new aws.cloudwatch.MetricAlarm("ec2-cpu-credits-low", {
      name:               "arham-ec2-cpu-credit-balance-low",
      alarmDescription:   "Mail EC2 CPU credit balance below 50 — sustained load will throttle mail delivery",
      namespace:          "AWS/EC2",
      metricName:         "CPUCreditBalance",
      dimensions:         ec2Dims,
      statistic:          "Average",
      period:             300,
      evaluationPeriods:  2,
      comparisonOperator: "LessThanThreshold",
      threshold:          50,
      treatMissingData:   "missing",
      alarmActions,
      okActions: alarmActions,
      tags: { Project: "arham-mail" },
    }, opts);

    // EC2 — instance/system status checks (covers both via StatusCheckFailed).
    new aws.cloudwatch.MetricAlarm("ec2-status-check-failed", {
      name:               "arham-ec2-status-check-failed",
      alarmDescription:   "Mail EC2 failed an instance or system status check",
      namespace:          "AWS/EC2",
      metricName:         "StatusCheckFailed",
      dimensions:         ec2Dims,
      statistic:          "Maximum",
      period:             60,
      evaluationPeriods:  2,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      threshold:          1,
      treatMissingData:   "breaching",
      alarmActions,
      okActions: alarmActions,
      tags: { Project: "arham-mail" },
    }, opts);

    // ─── EBS snapshots — DLM daily, 7 day retention ──────────────────────────
    // Targets the mail instance by its Backup=daily tag, so every attached volume
    // (root included) is captured in one crash-consistent multi-volume snapshot set.
    const dlmRole = new aws.iam.Role("dlm-lifecycle-role", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "dlm.amazonaws.com" }, Action: "sts:AssumeRole" }],
      }),
      tags: { Project: "arham-mail" },
    }, opts);

    new aws.iam.RolePolicyAttachment("dlm-lifecycle-role-policy", {
      role:      dlmRole.name,
      policyArn: "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole",
    }, opts);

    new aws.dlm.LifecyclePolicy("mail-ebs-daily", {
      description:      "Daily EBS snapshots of the Stalwart mail instance - 7 day retention",
      executionRoleArn: dlmRole.arn,
      state:            "ENABLED",
      policyDetails: {
        resourceTypes: ["INSTANCE"],
        targetTags:    { Backup: "daily" },
        schedules: [{
          name:     "daily-7d",
          copyTags: true,
          createRule: {
            interval:     24,
            intervalUnit: "HOURS",
            times:        "20:00",   // 01:30 IST — off-hours, clear of the RDS window
          },
          retainRule: { count: 7 },
          tagsToAdd: { Project: "arham-mail", SnapshotPolicy: "mail-ebs-daily" },
        }],
      },
      tags: { Project: "arham-mail" },
    }, opts);

    // ─── Outputs ──────────────────────────────────────────────────────────────
    this.mailElasticIp   = eip.publicIp;
    this.dbEndpoint      = db.endpoint;   // host:port — NOT usable as a bare PGHOST
    this.dbAddress       = db.address;    // bare hostname — use this in scripts/config
    this.s3BlobBucket    = mailBlobsBucket.bucket;
    this.sesSmtpUser     = sesAccessKey.id;
    this.sesSmtpPassword = sesAccessKey.sesSmtpPasswordV4;
    this.sesDkimTokens   = sesDkim.dkimTokens;
    this.alertsTopicArn  = alertsTopic.arn;
    this.sesEventsTopicArn        = sesEventsTopic.arn;
    this.sesConfigurationSet      = sesConfigSet.name;
    this.sesEventsEndpoint        = pulumi.output(sesEventsEndpoint);
    this.sesEventsSubscriptionArn = sesEventsSubscription.arn;

    this.registerOutputs({
      mailIp:          eip.publicIp,
      dbEndpoint:      db.endpoint,
      dbAddress:       db.address,
      dbPort:          db.port,
      blobBucket:      mailBlobsBucket.bucket,
      alertsTopicArn:  alertsTopic.arn,
      sesDkimTokens:   sesDkim.dkimTokens,
      sesSmtpUser:     sesAccessKey.id,
      sesSmtpPassword: sesAccessKey.sesSmtpPasswordV4,
      sesEventsTopicArn:   sesEventsTopic.arn,
      sesConfigurationSet: sesConfigSet.name,
      sesEventsEndpoint:   sesEventsEndpoint,
    });
  }
}
