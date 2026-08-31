# DO → AWS Mumbai Migration Checklist

> ### ⚠️ SES starts in SANDBOX — 200 messages/day
> A new SES account can send **200 messages per day**, and only to addresses you have
> individually verified. Production access is a support request that takes **24–48
> hours** to approve. **Submit it on day one (Step 5).** If you cut over before it is
> approved, outbound mail for every customer stops dead at 200 messages, and there is
> no way to hurry it along at 2am.

What you are migrating onto: **one** t4g.medium EC2 (Stalwart + nginx + a local redis6
sidecar), **one** RDS PostgreSQL db.t4g.micro, an S3 bucket for mail blobs, and SES for
outbound relay. There is no Aurora, no ElastiCache, no ALB and no NAT gateway — if a
step tells you to copy one of those outputs, the step is out of date.

That same EC2 also runs the product: console-app, webui and the three migration
workers, under PM2 behind nginx. `pulumi up` does **not** put them there — see
**Deploy the applications**. Skip that step and cutover moves DNS onto a mail server
with no product on it.

---

## Before You Start (30 min — you do this manually)

### Step 1: AWS Account
- [ ] Create AWS account at aws.amazon.com (or use existing)
- [ ] Enable billing alert: AWS Console → Billing → Budgets → Create budget (**$120/month**)
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

### Step 5: SES production access — DO THIS NOW, NOT LATER
This is account-level and needs nothing deployed yet. Filing it first is the whole
point — everything else takes hours, this takes days.

- [ ] AWS Console → SES (ap-south-1) → Account dashboard → **Request production access**
  - Mail type: Transactional
  - Use case: "Business email hosting service — we host mailboxes for paying customers"
  - Daily sending volume: 100,000
  - How you handle bounces/complaints: "Automatically via SNS notifications"
    (the stack implements this — see **SES bounce + complaint handling** below —
    but the SNS subscription still needs confirming after cutover)
- [ ] Note the case ID. Chase it if there is no answer in 48h.
- [ ] Do not schedule cutover until the console shows you are **out of the sandbox**.

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

# REQUIRED unless you want an instance you cannot SSH into. Port 22 is opened to
# these CIDRs and nobody else; leave it unset and 22 is not opened at all (the
# stack still deploys, `pulumi up` just warns). 0.0.0.0/0 is rejected outright.
# Comma-separate if you need office + home. Find yours with: curl -s ifconfig.me
pulumi config set sshAllowedCidr "$(curl -s ifconfig.me)/32"

# Optional: where SNS POSTs SES bounce/complaint events.
# Defaults to https://console.<domain>/api/ses/notifications
# pulumi config set sesEventsEndpoint https://console.arhamworkspace.tech/api/ses/notifications

# Use hex, not base64. RDS rejects a master password containing / @ " or space, and
# this same password is pasted into the console app's DATABASE_URL as a URL.
pulumi config set --secret dbPassword "$(openssl rand -hex 24)"

# Optional: where CloudWatch alarms page you
pulumi config set alertEmail ops@arhamworkspace.tech

# Deploy everything (~8 minutes first time)
pulumi up --stack aws-india
```

**Write the dbPassword down somewhere you can reach at 2am.** Every later step needs it
and Pulumi will only give it back with `pulumi config get --show-secrets dbPassword`.

### Save the outputs

```bash
pulumi stack output --stack aws-india
```

| Output | What it is |
|---|---|
| `mailIp` | Elastic IP of the mail EC2 — every A record points here |
| `dbAddress` | RDS hostname, **bare**. This is the one the scripts want. |
| `dbEndpoint` | Same host with `:5432` glued on. Do **not** paste this anywhere a hostname is expected. |
| `s3BlobBucket` | `arham-mail-blobs-in` |
| `sesDkimTokens` | 3 tokens → 3 CNAME records (below) |
| `sesSmtpUser` | SES SMTP username |
| `sesSmtpPassword` | SES SMTP password — **secret**, needs `--show-secrets` |
| `sesEventsTopicArn` | SNS topic `arham-ses-events` — bounces + complaints land here |
| `sesConfigurationSet` | `arham-mail-events` — the SES configuration set |
| `sesEventsEndpoint` | HTTPS endpoint SNS delivers those events to |

```bash
pulumi stack output sesSmtpPassword --show-secrets --stack aws-india
```

Redis has no output: it is a `redis6` sidecar on the EC2 instance itself, and every
script defaults to `127.0.0.1:6379`. You never set `REDIS_HOST`.

---

## Verify the SES domain (5 min — do it right after deploy)

- [ ] For each of the three `sesDkimTokens`, add a CNAME in Cloudflare:
  - Name: `<token>._domainkey.arhamworkspace.tech`
  - Value: `<token>.dkim.amazonses.com`
  - **Proxy: OFF** (grey cloud — Cloudflare must not proxy these)
- [ ] AWS Console → SES → Verified identities → wait for `arhamworkspace.tech` to go **Verified**
- [ ] Add SES to SPF if it isn't already: `v=spf1 include:amazonses.com ~all`

---

## SES bounce + complaint handling (wired by Pulumi — you confirm it)

The production-access request above tells AWS we handle bounces and complaints
automatically. The stack now implements that: a `arham-ses-events` SNS topic, an
`arham-mail-events` configuration set with a bounce/complaint event destination,
identity-level Bounce and Complaint feedback on the domain, and an HTTPS
subscription pointing at `https://console.<domain>/api/ses/notifications`.

This matters beyond the paperwork: SES suspends accounts that run over a 5% bounce
rate or a 0.1% complaint rate, and it counts them account-wide.

Two things the deploy cannot do for you:

- [ ] **The HTTPS subscription starts `PendingConfirmation`** and stays there until
      the console answers SNS's confirmation POST. It cannot confirm before
      cutover — `console.<domain>` does not resolve to the instance yet and has no
      real certificate. **After cutover and certbot**, go to SNS → Topics →
      `arham-ses-events` → Subscriptions → select the HTTPS one → **Request
      confirmation**. Refresh until Status is `Confirmed`.
      (Equivalent: delete the subscription and re-run `pulumi up`.)
- [ ] Confirm the endpoint handles **both payload shapes**. Identity feedback
      arrives as `{"notificationType":"Bounce"|"Complaint"}`; configuration-set
      events arrive as `{"eventType":"Bounce"|"Complaint"}`. It must also answer
      SNS `SubscriptionConfirmation` messages. Both are wired to the same topic
      because Stalwart relays over SMTP and does not stamp
      `X-SES-CONFIGURATION-SET`, so the configuration set alone would never fire.

**Known gap — per-tenant reputation isolation.** Every customer shares one SES
reputation today, so one tenant importing a stale contact list can bounce the
whole platform into a sending pause. Fixing it properly means a configuration set
per tenant, a dedicated IP pool for heavy senders, and Stalwart stamping
`X-SES-CONFIGURATION-SET` per sending domain — an application change, not an infra
one. It is deliberately **not** half-built here; track it as its own work item.

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
tail -f /var/log/arham-setup.log   # wait until "Bootstrap complete"

# Get the repo (or scp infra/scripts/ up) and run the Stalwart config script
export DB_HOST=<dbAddress from pulumi output — bare hostname, NOT dbEndpoint>
export DB_PASS=<dbPassword you set in pulumi config>
export S3_BUCKET=arham-mail-blobs-in
export SES_SMTP_USER=<sesSmtpUser from pulumi output>
export SES_SMTP_PASS=<sesSmtpPassword --show-secrets>
export DOMAIN=arhamworkspace.tech

bash infra/scripts/configure-stalwart.sh
```

The script checks it can reach RDS on 5432 and the local Redis on 6379 before it writes
anything, so a failure here is a security-group problem, not a config problem.

It will print the **DKIM TXT record** — add it to Cloudflare immediately. If it is not
published, our own signature fails to verify at the receiver, which scores *worse* than
sending unsigned.

**On TLS:** nginx owns ports 80/443 on this box and Stalwart's JMAP listener sits on
`127.0.0.1:8080` behind it. Let's Encrypt can't be issued yet — HTTP-01 needs DNS
pointing at this instance, which doesn't happen until cutover — so the script installs a
self-signed placeholder. You will see certificate warnings until the certbot step below.
That is expected.

**Vhosts this writes** — all four, because certbot can only issue for a hostname
that already has a `server_name` block:

| Hostname | Proxies to | Serves |
|---|---|---|
| `mail.<domain>` | `127.0.0.1:8080` | Stalwart JMAP |
| `console.<domain>` | `127.0.0.1:3002` | console-app |
| `inbox.<domain>` | `127.0.0.1:3002` | console-app (customer-facing name) |
| `webmail.<domain>` | `127.0.0.1:3000` | webui |

The last three answer **502 until the next step runs**. That is correct, not a fault.

**On IMAP:** port 143 is not open in the security group and Stalwart binds it on
loopback only, with cleartext auth refused. Mail clients must be configured for
**993 / SSL**, never 143 / STARTTLS. Every client anyone actually uses
(Thunderbird, Outlook, Apple Mail, iOS, Android) autoconfigures to 993, and Google
Workspace and Zoho — the two we migrate people off — publish 993 only, so no
customer arrives with a 143-shaped client. If a support ticket says "IMAP won't
connect", check the port before you check anything else.

---

## Deploy the applications (15 min — this is what puts the product on the box)

user_data installs Stalwart, Redis, nginx, Node and PM2. It installs **none** of
the product. Without this step the instance is a mail server with nothing on
`console.`, `inbox.` or `webmail.`.

Run it **from your laptop, in the repo checkout** (it packs the source, ships it,
builds it on the instance and starts it under PM2):

```bash
export AWS_EC2_IP=<mailIp from pulumi output>
export AWS_SSH_KEY=~/.ssh/arham-aws-key.pem
export AWS_PG_HOST=<dbAddress — bare hostname>
export AWS_PG_PASS=<dbPassword>
export DOMAIN=arhamworkspace.tech

bash infra/scripts/deploy-apps.sh
```

**Secrets it needs.** It sources two gitignored files, in this order, and the
second wins on any overlap:

| File | Keys |
|---|---|
| `console-app/.env.production.secrets` | `JMAP_ADMIN_AUTH`, `JWT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `MIGRATION_ENCRYPTION_KEY` |
| `infra/.env.deploy.secrets` | `SESSION_SECRET`, `STALWART_ADMIN_USER`, `STALWART_ADMIN_PASS`, optional `GROQ_API_KEY` |

It refuses to start if any required key is missing and tells you which — you will
not find out at the build step. `MIGRATION_ENCRYPTION_KEY` and `SESSION_SECRET`
must be **the same values the DO box uses**, or in-flight migration jobs cannot be
decrypted after cutover.

What ends up running under PM2:

| PM2 name | What | Port |
|---|---|---|
| `arham-console` | console-app (Next.js) | 127.0.0.1:3002 |
| `arham-webui` | webui (Next.js) | 127.0.0.1:3000 |
| `migration-orchestrator` | BullMQ worker | — |
| `migration-users` | BullMQ worker | — |
| `migration-messages` | BullMQ worker | — |

Env files are written on the instance (`.env.local` for the two Next apps, `.env`
for the workers, all mode 600) pointing at RDS over TLS, the local Redis sidecar
and Stalwart on loopback JMAP. `pm2 save` runs at the end, so the systemd unit
user_data installed brings everything back after a reboot.

The script verifies every app answers on loopback before it reports success, and
**exits non-zero if any of them doesn't**. Re-deploying one app later:

```bash
APPS=console bash infra/scripts/deploy-apps.sh    # or: webui | workers
```

Worker instance counts are deliberately 1-per-queue on this box (it also runs
Stalwart, nginx and two Next.js servers in 4 GB). If imports fall behind and
`free -m` says there is headroom, raise them in the generated
`~/arham-workers/ecosystem.aws.cjs` and `pm2 reload` it.

---

## Migrate Data (30 min, no downtime)

```bash
export AWS_EC2_IP=<mailIp from pulumi output>
export AWS_SSH_KEY=~/.ssh/arham-aws-key.pem
export AWS_PG_HOST=<dbAddress from pulumi output>
export AWS_PG_PASS=<dbPassword>

# Source database. Deliberately has no default in the scripts: it carries a live
# password, so it is never stored in the repo. Direct port 25060, not PgBouncer.
export DO_PG_URL='postgresql://<do-user>:<do-password>@<do-host>:25060'

bash infra/scripts/migrate-from-do.sh
```

`cutover.sh` needs `DO_PG_URL` too — export it in the same shell, or the script
stops before it touches anything.

### Check the schema migrations before starting the workers

The worker migrations `002` and `003`/`004` dedupe rows before adding unique
constraints, and they run automatically at worker startup. On a fresh database
they do nothing; against the data just restored from DigitalOcean they may
delete rows. Look before you leap:

```bash
cd workers
MIGRATION_PG_URL="postgresql://arhamapp:<dbPassword>@<dbAddress>:5432/arham-migration?sslmode=require" \
  npm run migrations:dry-run
```

It is read-only — it opens a transaction and always rolls back. Expect
"Nothing destructive to do" on a first migration. If it reports rows that will
be deleted, take an RDS snapshot before continuing.

This copies both Postgres databases, streams the Flux on-disk state over, and then
calls `deploy-apps.sh` for you (console + webui + workers) — so if you already ran
that step by hand, this just redeploys the same three apps. Mailbox *contents* move
through the IMAP migration workers, not this script — on AWS the message store is
Postgres + S3, not a local directory.

Both the bulk copy here and the final sync in `cutover.sh` now run psql with
`ON_ERROR_STOP=1`: a SQL error aborts the script instead of printing "migrated" over
an empty database. If it stops on a role or extension error, fix that error — do not
work around it by removing the flag.

Test the AWS server thoroughly before cutover.

---

## Cutover (~5 min downtime)

```bash
# same four variables as above
bash infra/scripts/cutover.sh
```

Then update Cloudflare DNS to point all records to the AWS Elastic IP (`mailIp`).
The script prints the exact record list when it finishes.

`cutover.sh` verifies JMAP plus all three app hostnames through nginx **before** it
tells you to move DNS. If any check fails it prints `DO NOT MOVE DNS`, tells you
where to look, and exits non-zero — mail is down on both sides at that point, so
either fix it or roll back to DO with
`ssh ubuntu@<do-ip> 'sudo systemctl start flux'`.

---

## Immediately after DNS moves: issue the real certificate

Nothing works properly on the self-signed placeholder — mail clients will refuse
IMAPS/SMTPS. Do this as soon as `dig mail.arhamworkspace.tech` returns the new IP.

One certificate covers every vhost — issue them all in a single run, or
`console.`/`inbox.`/`webmail.` keep serving the self-signed placeholder:

```bash
ssh -i ~/.ssh/arham-aws-key.pem ec2-user@<mailIp>
sudo certbot --nginx -d arhamworkspace.tech -d mail.arhamworkspace.tech \
             -d console.arhamworkspace.tech -d inbox.arhamworkspace.tech \
             -d webmail.arhamworkspace.tech
# then re-run configure-stalwart.sh so the mail ports pick up the real cert
```

---

## Post-Cutover (same day)

- [ ] Send test email to Gmail — check spam vs inbox
- [ ] Check Authentication-Results header for DKIM=pass, SPF=pass
- [ ] Verify MXToolbox: https://mxtoolbox.com/SuperTool.aspx
- [ ] `openssl s_client -connect mail.arhamworkspace.tech:993` — confirm a real cert
- [ ] `curl -I https://console.arhamworkspace.tech/` — and `inbox.`, and `webmail.`
      (a 502 means PM2 is down: `pm2 status`; a 404 means the vhost is missing:
      re-run `configure-stalwart.sh`)
- [ ] **Confirm the `arham-ses-events` SNS subscription** (SNS → Topics →
      `arham-ses-events` → Subscriptions → Request confirmation). Until it says
      `Confirmed`, bounces and complaints are going nowhere and the promise made in
      the production-access request is not being kept.
- [ ] Send a message to `bounce@simulator.amazonses.com` and confirm the console
      endpoint received the notification
- [ ] Confirm the SES sending quota on the Account dashboard is the production one
- [ ] Rotate the DO PostgreSQL password (it is hardcoded in the migration scripts)
- [ ] Monitor for 24 hours
- [ ] Cancel DO droplet (NOT managed PG/Redis yet — wait 48h)
- [ ] After 48h stable: cancel DO managed PostgreSQL and Redis

---

## Cost After Migration

Every line below is a resource `infra/aws-india.ts` actually declares. Rates are
ap-south-1 (Mumbai) on-demand, 730 hours/month. Re-check the AWS calculator before
quoting these to anyone — regional rates move.

| Line item | Rate | Qty | $/month |
|---|---|---|---|
| EC2 t4g.medium (Graviton, on-demand) | $0.0224/hr | 730 hr | 16.35 |
| EBS gp3 root volume | $0.0912/GB-mo | 40 GB | 3.65 |
| Public IPv4 (the Elastic IP) | $0.005/hr | 730 hr | 3.65 |
| RDS db.t4g.micro PostgreSQL, single-AZ | $0.018/hr | 730 hr | 13.14 |
| RDS gp3 storage | $0.138/GB-mo | 20 GB | 2.76 |
| RDS backup storage (14-day retention) | $0.114/GB-mo | ~20 GB billable | 2.28 |
| EBS snapshots (DLM daily, 7-day retention) | $0.05/GB-mo | ~50 GB stored | 2.50 |
| S3 Standard + requests | $0.025/GB-mo | 100 GB | 2.80 |
| SES outbound relay | $0.10 / 1,000 msgs | 50,000 msgs | 5.00 |
| Data transfer out | $0.1093/GB after 100 GB free | ~60 GB | 0.00 |
| CloudWatch alarms + SNS | $0.10/alarm | 5 alarms | 0.50 |
| **Subtotal (pre-tax)** | | | **52.63** |
| GST @ 18% (Indian billing) | | | 9.47 |
| **Total** | | | **~$62/month** |

**Assumptions — change these and the number moves:**
- 100 GB of mail blobs in S3. Versioning is **on**, but noncurrent versions now
  expire after 60 days and abandoned multipart uploads after 7, so deleting a
  mailbox stops billing rather than billing forever. Budget roughly 60 days of
  churn on top of live storage. At 500 GB live this line is ~$13, not $2.80.
- 50,000 outbound messages/month. SES is linear: 200k messages is $20, not $5.
- Under 100 GB/month egress, which is the AWS free allowance. Above it, $0.1093/GB.
- The t4g.medium stays inside its CPU credit baseline (20%). If it burns credits in
  unlimited mode, add roughly $0.05 per vCPU-hour of surplus.
- RDS backup: 14 days of retention on a 20 GB volume; the first 20 GB is free, so this
  bills roughly one extra volume's worth.
- No reserved instances or Savings Plans. A 1-year no-upfront commitment on the EC2 and
  RDS instances takes ~$9/month off, landing around $44 pre-tax / $52 with GST.

### Honest comparison against DigitalOcean

| | Pre-tax | With 18% GST |
|---|---|---|
| DigitalOcean today | $63.91 | ~$75.42 |
| AWS Mumbai (this stack) | $52.63 | ~$62.10 |
| **Difference** | **−$11.28/mo** | **−$13.31/mo** |

That is about **18%**, roughly $160/year. Real, but not transformative — and thin enough
that a growth spurt in S3 storage or SES volume erases it. The reasons to do this
migration are India data residency, SES deliverability and managed backups; treat the
cost saving as a bonus, not the business case.
