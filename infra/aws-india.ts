import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const cfg = new pulumi.Config();
const domain        = cfg.get("domain")        ?? "arhamworkspace.tech";
const dbPassword    = cfg.requireSecret("dbPassword");
const keyPairName   = cfg.get("keyPairName")   ?? "arham-key";

export class ArhamAwsIndiaStack extends pulumi.ComponentResource {
  public readonly mailElasticIp:  pulumi.Output<string>;
  public readonly auroraEndpoint: pulumi.Output<string>;
  public readonly redisEndpoint:  pulumi.Output<string>;
  public readonly s3BlobBucket:   pulumi.Output<string>;
  public readonly albDns:         pulumi.Output<string>;

  constructor(name: string) {
    super("arham:stack:AwsIndia", name);
    const opts = { parent: this };

    // ─── VPC ────────────────────────────────────────────────────────────────
    const vpc = new awsx.ec2.Vpc("arham-vpc", {
      cidrBlock: "10.0.0.0/16",
      numberOfAvailabilityZones: 2,
      natGateways: { strategy: "Single" },   // one NAT GW — saves ~$30/mo vs one per AZ
      tags: { Name: "arham-vpc", Project: "arham-mail" },
    }, opts);

    // ─── Security Groups ─────────────────────────────────────────────────────

    // Mail server: exposes all mail + JMAP ports publicly
    const mailSg = new aws.ec2.SecurityGroup("mail-sg", {
      vpcId: vpc.vpcId,
      description: "Stalwart mail server",
      ingress: [
        { protocol: "tcp", fromPort: 22,   toPort: 22,   cidrBlocks: ["0.0.0.0/0"], description: "SSH" },
        { protocol: "tcp", fromPort: 25,   toPort: 25,   cidrBlocks: ["0.0.0.0/0"], description: "SMTP" },
        { protocol: "tcp", fromPort: 465,  toPort: 465,  cidrBlocks: ["0.0.0.0/0"], description: "SMTPS" },
        { protocol: "tcp", fromPort: 587,  toPort: 587,  cidrBlocks: ["0.0.0.0/0"], description: "Submission" },
        { protocol: "tcp", fromPort: 143,  toPort: 143,  cidrBlocks: ["0.0.0.0/0"], description: "IMAP" },
        { protocol: "tcp", fromPort: 993,  toPort: 993,  cidrBlocks: ["0.0.0.0/0"], description: "IMAPS" },
        { protocol: "tcp", fromPort: 80,   toPort: 80,   cidrBlocks: ["0.0.0.0/0"], description: "HTTP/ACME" },
        { protocol: "tcp", fromPort: 443,  toPort: 443,  cidrBlocks: ["0.0.0.0/0"], description: "HTTPS" },
      ],
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      tags: { Name: "arham-mail-sg" },
    }, opts);

    // DB: only accessible from mail SG and ALB SG
    const dbSg = new aws.ec2.SecurityGroup("db-sg", {
      vpcId: vpc.vpcId,
      description: "Aurora + ElastiCache — internal only",
      ingress: [
        { protocol: "tcp", fromPort: 5432, toPort: 5432, securityGroups: [mailSg.id], description: "PostgreSQL from mail" },
        { protocol: "tcp", fromPort: 6379, toPort: 6379, securityGroups: [mailSg.id], description: "Redis from mail" },
      ],
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      tags: { Name: "arham-db-sg" },
    }, opts);

    // ALB: web traffic for console + webui
    const albSg = new aws.ec2.SecurityGroup("alb-sg", {
      vpcId: vpc.vpcId,
      description: "ALB for console and webui",
      ingress: [
        { protocol: "tcp", fromPort: 80,  toPort: 80,  cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
      ],
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      tags: { Name: "arham-alb-sg" },
    }, opts);

    // ─── ACM Certificate ─────────────────────────────────────────────────────
    const cert = new aws.acm.Certificate("arham-cert", {
      domainName: `*.${domain}`,
      subjectAlternativeNames: [domain],
      validationMethod: "DNS",
      tags: { Project: "arham-mail" },
    }, opts);

    // ─── EC2 Graviton — Stalwart mail server ─────────────────────────────────
    // ARM64 (Graviton3): 20-40% cheaper than x86, Stalwart has ARM musl binary
    const stalwartAmi = aws.ec2.getAmiOutput({
      owners: ["amazon"],
      mostRecent: true,
      filters: [
        { name: "name",          values: ["al2023-ami-*-arm64"] },
        { name: "architecture",  values: ["arm64"] },
        { name: "state",         values: ["available"] },
      ],
    });

    // Startup script: runs once on first boot to install everything
    const userData = `#!/bin/bash
set -e
exec > /var/log/arham-setup.log 2>&1

# System
dnf update -y
dnf install -y nginx certbot python3-certbot-nginx wget tar curl

# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
npm install -g pm2

# Stalwart ARM64 binary
STALWART_VER="v0.16.19"
curl -fsSL -o /tmp/stalwart.tar.gz \\
  "https://github.com/stalwartlabs/mail-server/releases/download/\${STALWART_VER}/stalwart-aarch64-unknown-linux-musl.tar.gz"
cd /tmp && tar -xzf stalwart.tar.gz && chmod +x stalwart
mv stalwart /usr/local/bin/stalwart-mail

# Directories
mkdir -p /var/lib/stalwart-mail /etc/stalwart-mail
useradd -r -s /bin/false stalwart 2>/dev/null || true
chown stalwart:stalwart /var/lib/stalwart-mail

# Systemd service
cat > /etc/systemd/system/stalwart-mail.service << 'EOF'
[Unit]
Description=Stalwart Mail Server
After=network.target

[Service]
Type=simple
User=stalwart
ExecStart=/usr/local/bin/stalwart-mail --config /etc/stalwart-mail/config.toml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable stalwart-mail

# PM2 startup
pm2 startup systemd -u ubuntu --hp /home/ubuntu
echo "Setup complete — configure /etc/stalwart-mail/config.toml then start stalwart-mail service"
`;

    const mailServer = new aws.ec2.Instance("stalwart", {
      instanceType: "c7g.medium",   // 2 vCPU / 4 GB Graviton3 — ~$25/mo
      ami: stalwartAmi.id,
      subnetId: vpc.publicSubnetIds[0],
      vpcSecurityGroupIds: [mailSg.id],
      keyName: keyPairName,
      rootBlockDevice: {
        volumeType: "gp3",
        volumeSize: 40,            // 40 GB SSD for OS + logs (mail blobs go to S3)
        encrypted: true,
      },
      userData: userData,
      tags: { Name: "arham-stalwart-in", Project: "arham-mail" },
    }, opts);

    // Static IP — survives reboots and can be reassigned on failure
    const eip = new aws.ec2.Eip("stalwart-eip", {
      instance: mailServer.id,
      tags: { Name: "arham-mail-ip" },
    }, opts);

    // ─── Aurora Serverless v2 ─────────────────────────────────────────────────
    const dbSubnetGroup = new aws.rds.SubnetGroup("arham-db-subnets", {
      subnetIds: vpc.privateSubnetIds,
      tags: { Name: "arham-db-subnet-group" },
    }, opts);

    const aurora = new aws.rds.Cluster("arham-db", {
      clusterIdentifier:    "arham-mail-db",
      engine:               "aurora-postgresql",
      engineMode:           "provisioned",
      engineVersion:        "15.4",
      databaseName:         "arham",
      masterUsername:       "arhamapp",
      masterPassword:       dbPassword,
      dbSubnetGroupName:    dbSubnetGroup.name,
      vpcSecurityGroupIds:  [dbSg.id],
      skipFinalSnapshot:    false,
      finalSnapshotIdentifier: "arham-db-final-snapshot",
      backupRetentionPeriod: 7,
      preferredBackupWindow: "02:00-03:00",
      storageEncrypted:     true,
      serverlessv2ScalingConfiguration: {
        minCapacity: 0.5,    // $43/mo idle — scales up automatically
        maxCapacity: 64,     // handles 500k+ users
      },
      tags: { Project: "arham-mail" },
    }, opts);

    // At least one writer instance required for Serverless v2
    const auroraInstance = new aws.rds.ClusterInstance("arham-db-writer", {
      identifier:          "arham-mail-db-writer",
      clusterIdentifier:   aurora.id,
      instanceClass:       "db.serverless",
      engine:              aurora.engine,
      engineVersion:       aurora.engineVersion,
      dbSubnetGroupName:   dbSubnetGroup.name,
      publiclyAccessible:  false,
      tags: { Project: "arham-mail" },
    }, opts);

    // RDS Proxy — connection pooling (replaces PgBouncer)
    const proxyRole = new aws.iam.Role("rds-proxy-role", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "rds.amazonaws.com" }, Action: "sts:AssumeRole" }],
      }),
    }, opts);
    new aws.iam.RolePolicyAttachment("rds-proxy-policy", {
      role: proxyRole.name,
      policyArn: "arn:aws:iam::aws:policy/AmazonRDSFullAccess",
    }, opts);

    // ─── ElastiCache Redis ────────────────────────────────────────────────────
    const cacheSubnetGroup = new aws.elasticache.SubnetGroup("arham-cache-subnets", {
      subnetIds: vpc.privateSubnetIds,
    }, opts);

    const redis = new aws.elasticache.Cluster("arham-redis", {
      clusterId:          "arham-redis",
      engine:             "redis",
      nodeType:           "cache.t3.micro",   // $12/mo — upgrade to t3.medium at 50k users
      numCacheNodes:      1,
      parameterGroupName: "default.redis7",
      engineVersion:      "7.0",
      subnetGroupName:    cacheSubnetGroup.name,
      securityGroupIds:   [dbSg.id],
      tags:               { Project: "arham-mail" },
    }, opts);

    // ─── S3 Buckets ──────────────────────────────────────────────────────────

    // Mail blobs (email bodies + attachments) — India data residency
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

    // Console/webui static assets — CloudFront origin
    const staticBucket = new aws.s3.Bucket("static-assets", {
      bucket: "arham-static-assets-in",
      tags: { Project: "arham-mail" },
    }, opts);

    // ─── SES (outbound email relay) ───────────────────────────────────────────
    const sesDomain = new aws.ses.DomainIdentity("arham-ses-domain", {
      domain: domain,
    }, opts);

    // DKIM tokens — add these as CNAME records in Cloudflare
    const sesDkim = new aws.ses.DomainDkim("arham-ses-dkim", {
      domain: sesDomain.domain,
    }, opts);

    // SES SMTP IAM user — credentials go in Stalwart config
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

    // ─── ALB for console + webui ──────────────────────────────────────────────
    const alb = new aws.lb.LoadBalancer("arham-alb", {
      name:             "arham-alb",
      internal:         false,
      loadBalancerType: "application",
      securityGroups:   [albSg.id],
      subnets:          vpc.publicSubnetIds,
      tags:             { Project: "arham-mail" },
    }, opts);

    // HTTP → HTTPS redirect
    new aws.lb.Listener("http-redirect", {
      loadBalancerArn: alb.arn,
      port:            80,
      protocol:        "HTTP",
      defaultActions:  [{ type: "redirect", redirect: { protocol: "HTTPS", port: "443", statusCode: "HTTP_301" } }],
    }, opts);

    // ECS Cluster for console + workers
    const ecsCluster = new aws.ecs.Cluster("arham-ecs", {
      name: "arham-mail-cluster",
      settings: [{ name: "containerInsights", value: "enabled" }],
      tags: { Project: "arham-mail" },
    }, opts);

    // Fargate task execution role
    const executionRole = new aws.iam.Role("fargate-execution-role", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "ecs-tasks.amazonaws.com" }, Action: "sts:AssumeRole" }],
      }),
    }, opts);
    new aws.iam.RolePolicyAttachment("fargate-execution-policy", {
      role: executionRole.name,
      policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    }, opts);

    // ─── CloudFront for static console assets ─────────────────────────────────
    const oac = new aws.cloudfront.OriginAccessControl("arham-oac", {
      name:                          "arham-static-oac",
      originAccessControlOriginType: "s3",
      signingBehavior:               "always",
      signingProtocol:               "sigv4",
    }, opts);

    const cdn = new aws.cloudfront.Distribution("arham-cdn", {
      enabled:           true,
      defaultRootObject: "index.html",
      origins: [{
        originId:               staticBucket.id,
        domainName:             staticBucket.bucketRegionalDomainName,
        originAccessControlId:  oac.id,
      }],
      defaultCacheBehavior: {
        targetOriginId:       staticBucket.id,
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods:       ["GET", "HEAD", "OPTIONS"],
        cachedMethods:        ["GET", "HEAD"],
        forwardedValues:      { queryString: false, cookies: { forward: "none" } },
        compress:             true,
      },
      restrictions: { geoRestriction: { restrictionType: "none" } },
      viewerCertificate: { cloudfrontDefaultCertificate: true },
      tags: { Project: "arham-mail" },
    }, opts);

    // ─── Outputs ─────────────────────────────────────────────────────────────
    this.mailElasticIp  = eip.publicIp;
    this.auroraEndpoint = aurora.endpoint;
    this.redisEndpoint  = redis.cacheNodes[0].address;
    this.s3BlobBucket   = mailBlobsBucket.bucket;
    this.albDns         = alb.dnsName;

    // Useful outputs to print after deploy
    this.registerOutputs({
      mailIp:              eip.publicIp,
      auroraEndpoint:      aurora.endpoint,
      auroraPort:          aurora.port,
      redisHost:           redis.cacheNodes[0].address,
      redisPort:           redis.cacheNodes[0].port,
      blobBucket:          mailBlobsBucket.bucket,
      albDns:              alb.dnsName,
      cdnDomain:           cdn.domainName,
      sesDkimTokens:       sesDkim.dkimTokens,
      sesSmtpUser:         sesAccessKey.id,
      sesSmtpPassword:     sesAccessKey.sesSmtpPasswordV4,
    });
  }
}
