#!/bin/bash
# Run this on the new AWS EC2 instance AFTER pulumi up
# Usage: bash configure-stalwart.sh
# Requires: environment variables set (see below)
set -e

# ─── Fill these from `pulumi stack output` ───────────────────────────────────
AURORA_HOST="${AURORA_HOST:?Set AURORA_HOST from pulumi stack output}"
AURORA_PASS="${AURORA_PASS:?Set AURORA_PASS}"
REDIS_HOST="${REDIS_HOST:?Set REDIS_HOST from pulumi stack output}"
S3_BUCKET="${S3_BUCKET:-arham-mail-blobs-in}"
SES_SMTP_USER="${SES_SMTP_USER:?Set SES_SMTP_USER from pulumi stack output}"
SES_SMTP_PASS="${SES_SMTP_PASS:?Set SES_SMTP_PASS from pulumi stack output}"
DOMAIN="${DOMAIN:-arhamworkspace.tech}"
# ─────────────────────────────────────────────────────────────────────────────

echo "=== Configuring Stalwart on AWS EC2 ==="

# Create Stalwart config
sudo tee /etc/stalwart-mail/config.toml > /dev/null << EOF
[server]
hostname = "mail.${DOMAIN}"

# Store backend: PostgreSQL (distributed, HA) instead of RocksDB
[store."pg"]
type = "postgresql"
host = "${AURORA_HOST}"
port = 5432
database = "arham"
user = "arhamapp"
password = "${AURORA_PASS}"
tls = true

[store."s3"]
type = "s3"
bucket = "${S3_BUCKET}"
region = "ap-south-1"

[storage]
data = "pg"
fts = "pg"
blob = "s3"
lookup = "pg"
directory = "pg"

# Redis for session/rate limiting
[store."redis"]
type = "redis"
host = "${REDIS_HOST}"
port = 6379

[session.cache]
store = "redis"

# SMTP listeners
[server.listener."smtp"]
bind = ["0.0.0.0:25"]
protocol = "smtp"

[server.listener."submission"]
bind = ["0.0.0.0:587"]
protocol = "smtp"
tls.implicit = false

[server.listener."submissions"]
bind = ["0.0.0.0:465"]
protocol = "smtp"
tls.implicit = true

# IMAP listeners
[server.listener."imap"]
bind = ["0.0.0.0:143"]
protocol = "imap"

[server.listener."imaps"]
bind = ["0.0.0.0:993"]
protocol = "imap"
tls.implicit = true

# JMAP / HTTP
[server.listener."https"]
bind = ["0.0.0.0:443"]
protocol = "http"
tls.implicit = true

[server.listener."http"]
bind = ["0.0.0.0:80"]
protocol = "http"
tls.implicit = false

# TLS: Let's Encrypt via ACME
[acme."letsencrypt"]
directory = "https://acme-v02.api.letsencrypt.org/directory"
contact = ["admin@${DOMAIN}"]
domains = ["${DOMAIN}", "mail.${DOMAIN}", "*.${DOMAIN}"]

[certificate."default"]
cert = "%{acme.letsencrypt}%"
private-key = "%{acme.letsencrypt}%"

# Outbound relay: Amazon SES Mumbai
[queue.outbound.next-hop."ses-relay"]
host = "email-smtp.ap-south-1.amazonaws.com"
port = 587
credentials.username = "${SES_SMTP_USER}"
credentials.password = "${SES_SMTP_PASS}"
tls = true

[queue.outbound]
next-hop = ["ses-relay"]

# DKIM signing
[signature."arhamworkspace"]
algorithm = "rsa-sha256"
domain = "${DOMAIN}"
selector = "arham1"
headers = ["From", "To", "Subject", "Date", "Message-ID", "MIME-Version"]

# Admin (recovery)
[authentication.secret-fallback]
user = "admin"
EOF

echo "Config written to /etc/stalwart-mail/config.toml"

# Generate DKIM key
echo ""
echo "=== Generating DKIM key ==="
sudo -u stalwart stalwart-mail --dkim-generate \
  --domain "${DOMAIN}" \
  --selector "arham1" \
  --output /etc/stalwart-mail/dkim-arham1.pem 2>/dev/null || \
  openssl genrsa -out /etc/stalwart-mail/dkim-arham1.pem 2048

DKIM_PUBLIC=$(openssl rsa -in /etc/stalwart-mail/dkim-arham1.pem -pubout 2>/dev/null \
  | grep -v "PUBLIC KEY" | tr -d '\n')

echo ""
echo "=== DKIM DNS Record (add to Cloudflare) ==="
echo "Type: TXT"
echo "Name: arham1._domainkey.${DOMAIN}"
echo "Value: v=DKIM1; k=rsa; p=${DKIM_PUBLIC}"
echo ""

# Start Stalwart
sudo systemctl start stalwart-mail
sleep 3
sudo systemctl status stalwart-mail --no-pager -l | head -20

echo ""
echo "=== Stalwart configured and running ==="
echo "JMAP: https://mail.${DOMAIN}/jmap/session"
echo "Admin: admin:FluxAdmin2026! (STALWART_RECOVERY_ADMIN)"
