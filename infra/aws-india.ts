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
        { protocol: "tcp", fromPort: 22,  toPort: 22,  cidrBlocks: ["0.0.0.0/0"], description: "SSH" },
        { protocol: "tcp", fromPort: 25,  toPort: 25,  cidrBlocks: ["0.0.0.0/0"], description: "SMTP" },
        { protocol: "tcp", fromPort: 465, toPort: 465, cidrBlocks: ["0.0.0.0/0"], description: "SMTPS" },
        { protocol: "tcp", fromPort: 587, toPort: 587, cidrBlocks: ["0.0.0.0/0"], description: "Submission" },
        { protocol: "tcp", fromPort: 143, toPort: 143, cidrBlocks: ["0.0.0.0/0"], description: "IMAP" },
        { protocol: "tcp", fromPort: 993, toPort: 993, cidrBlocks: ["0.0.0.0/0"], description: "IMAPS" },
        { protocol: "tcp", fromPort: 80,  toPort: 80,  cidrBlocks: ["0.0.0.0/0"], description: "HTTP / ACME" },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"], description: "HTTPS" },
      ],
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      tags: { Name: "arham-mail-sg" },
    }, opts);

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
    const stalwartAmi = aws.ec2.getAmiOutput({
      owners: ["amazon"],
      mostRecent: true,
      filters: [
        { name: "name",         values: ["al2023-ami-*-arm64"] },
        { name: "architecture", values: ["arm64"] },
        { name: "state",        values: ["available"] },
      ],
    });

    // Runs once on first boot — installs Stalwart + nginx + Redis sidecar
    const userData = `#!/bin/bash
set -e
exec > /var/log/arham-setup.log 2>&1

# System
dnf update -y
dnf install -y nginx certbot python3-certbot-nginx wget tar curl redis6

# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
npm install -g pm2

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

pm2 startup systemd -u ec2-user --hp /home/ec2-user
echo "Bootstrap complete. Next: copy config to /etc/stalwart-mail/config.toml then systemctl start stalwart-mail"
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

    const ec2InstanceProfile = new aws.iam.InstanceProfile("stalwart-profile", {
      role: ec2Role.name,
    }, opts);

    const mailServer = new aws.ec2.Instance("stalwart", {
      instanceType: "t4g.medium",
      ami: stalwartAmi.id,
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
      description:      "Daily EBS snapshots of the Stalwart mail instance (7 day retention)",
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
    });
  }
}
