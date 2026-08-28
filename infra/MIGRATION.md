# DO → AWS Mumbai Migration Checklist

## Before You Start (30 min — you do this manually)

### Step 1: AWS Account
- [ ] Create AWS account at aws.amazon.com (or use existing)
- [ ] Enable billing alert: AWS Console → Billing → Budgets → Create budget ($200/month)
- [ ] Open ap-south-1 region if not already open

### Step 2: IAM
- [ ] AWS Console → IAM → Users → Create user: `arham-pulumi`
- [ ] Attach policy: `AdministratorAccess` (we'll tighten later)
- [ ] Create access key → save as:
  ```
  AWS_ACCESS_KEY_ID=AKIA...
  AWS_SECRET_ACCESS_KEY=...
  ```

### Step 3: EC2 Key Pair
- [ ] AWS Console → EC2 → Key Pairs → Create key pair
- [ ] Name: `arham-key`
- [ ] Type: ED25519
- [ ] Download `arham-key.pem` → save to `~/.ssh/arham-aws-key.pem`
- [ ] `chmod 400 ~/.ssh/arham-aws-key.pem`

### Step 4: Pulumi
- [ ] `npm install -g pulumi`
- [ ] `pulumi login` (creates free Pulumi Cloud account for state)
  - OR: `pulumi login --local` (stores state locally in ~/.pulumi)

---

## Deploy Infrastructure (10 min)

```bash
cd "infra/"
npm install

# Configure AWS credentials
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=ap-south-1

# Set stack config
pulumi stack init aws-india
pulumi config set aws:region ap-south-1
pulumi config set domain arhamworkspace.tech
pulumi config set keyPairName arham-key
pulumi config set --secret dbPassword "$(openssl rand -base64 24)"

# Deploy everything (~8 minutes first time)
pulumi up --stack aws-india
```

After it finishes, save the outputs:
```bash
pulumi stack output --stack aws-india
# → mailIp, auroraEndpoint, redisHost, blobBucket, albDns
# → sesDkimTokens, sesSmtpUser, sesSmtpPassword (for SES relay)
```

---

## Lower DNS TTL Now (do this 24h before cutover)

In Cloudflare, set ALL A records for arhamworkspace.tech to TTL = 60 seconds.
This means DNS cutover takes effect in 60 seconds instead of hours.

---

## Configure Server (20 min)

SSH into the new EC2 instance, then run:

```bash
# Wait for user_data to finish (~3 min after first boot)
ssh -i ~/.ssh/arham-aws-key.pem ec2-user@<mailIp>
tail -f /var/log/arham-setup.log   # wait until "Setup complete"

# Run Stalwart config script
export AURORA_HOST=<auroraEndpoint from pulumi output>
export AURORA_PASS=<dbPassword you set in pulumi config>
export REDIS_HOST=<redisHost from pulumi output>
export S3_BUCKET=arham-mail-blobs-in
export SES_SMTP_USER=<sesSmtpUser from pulumi output>
export SES_SMTP_PASS=<sesSmtpPassword from pulumi output>
export DOMAIN=arhamworkspace.tech

bash infra/scripts/configure-stalwart.sh
```

The script will print the DKIM DNS record — add it to Cloudflare immediately.

---

## SES Setup (15 min)

- [ ] AWS Console → SES → Verified identities → Verify `arhamworkspace.tech`
- [ ] Add the CNAME records SES gives you to Cloudflare
- [ ] AWS Console → SES → Account dashboard → Request production access
  (takes 24-48h — submit this NOW so it's approved before cutover)
  - Use case: "Business email hosting service"
  - Daily sending volume: 100,000
  - How you handle bounces: "Automatically via SNS webhook"

---

## Migrate Data (30 min, no downtime)

```bash
export AWS_EC2_IP=<mailIp from pulumi output>
export AWS_SSH_KEY=~/.ssh/arham-aws-key.pem
export AWS_PG_HOST=<auroraEndpoint>
export AWS_PG_PASS=<dbPassword>

bash infra/scripts/migrate-from-do.sh
```

Test the AWS server thoroughly before cutover.

---

## Cutover (~5 min downtime)

```bash
bash infra/scripts/cutover.sh
```

Then update Cloudflare DNS to point all records to the AWS Elastic IP.

---

## Post-Cutover (same day)

- [ ] Send test email to Gmail — check spam vs inbox
- [ ] Check Authentication-Results header for DKIM=pass, SPF=pass
- [ ] Verify MXToolbox: https://mxtoolbox.com/SuperTool.aspx
- [ ] Monitor for 24 hours
- [ ] Cancel DO droplet (NOT managed PG/Redis yet — wait 48h)
- [ ] After 48h stable: cancel DO managed PostgreSQL and Redis

---

## Cost After Migration

| Service | Monthly |
|---|---|
| EC2 c7g.medium (Graviton) | $25 |
| Aurora Serverless v2 (0.5 ACU min) | $43 |
| ElastiCache t3.micro | $12 |
| S3 + data transfer | $8 |
| SES (200k emails) | $20 |
| ALB | $16 |
| NAT Gateway | $32 |
| **Total** | **~$156/month** |

Reserve EC2 + RDS for 1 year: saves ~$30/month → ~$126/month
