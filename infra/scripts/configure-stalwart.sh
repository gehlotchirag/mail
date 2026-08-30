#!/bin/bash
# Configure Stalwart on the AWS EC2 mail instance.
#
# Run this ON the instance (ssh ec2-user@<mailIp>), AFTER `pulumi up` finished and
# AFTER user_data completed — tail /var/log/arham-setup.log for "Bootstrap complete".
#
# Stack shape this assumes (infra/aws-india.ts):
#   - ONE t4g.medium EC2: Stalwart + nginx + a local redis6 sidecar
#   - ONE RDS PostgreSQL db.t4g.micro, single-AZ, in the private subnets
#   - S3 bucket for mail blobs, SES for outbound relay
# There is no Aurora, no ElastiCache, no ALB. Do not go looking for those outputs.
set -euo pipefail

# ─── Fill these from `pulumi stack output` (run it in infra/) ────────────────
# dbAddress is the BARE hostname. dbEndpoint is host:port and will NOT work here.
DB_HOST="${DB_HOST:?Set DB_HOST — pulumi stack output dbAddress}"
DB_PASS="${DB_PASS:?Set DB_PASS — the dbPassword you gave 'pulumi config set --secret dbPassword'}"
DB_NAME="${DB_NAME:-arham}"
DB_USER="${DB_USER:-arhamapp}"
S3_BUCKET="${S3_BUCKET:-arham-mail-blobs-in}"   # pulumi stack output s3BlobBucket
SES_SMTP_USER="${SES_SMTP_USER:?Set SES_SMTP_USER — pulumi stack output sesSmtpUser}"
SES_SMTP_PASS="${SES_SMTP_PASS:?Set SES_SMTP_PASS — pulumi stack output sesSmtpPassword --show-secrets}"
DOMAIN="${DOMAIN:-arhamworkspace.tech}"

# Redis is a LOCAL sidecar (redis6, installed by user_data). It is not ElastiCache and
# has no Pulumi output. Only override REDIS_HOST if you ever move Redis off-box.
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"

# Stalwart's HTTP/JMAP listener is loopback-only; nginx owns 80/443 on this box
# (it also fronts the console app), so Stalwart must NOT bind them itself.
JMAP_PORT="${JMAP_PORT:-8080}"

# The two Next.js apps this box also runs, fronted by the vhosts written below.
# Keep these in step with infra/scripts/deploy-apps.sh — it starts the apps on
# exactly these ports. console-app pins its own port in `npm start` (next start
# -p 3002); webui takes PORT from its env file.
CONSOLE_PORT="${CONSOLE_PORT:-3002}"   # console-app  → console.  and inbox.
WEBUI_PORT="${WEBUI_PORT:-3000}"       # webui        → webmail.
# ─────────────────────────────────────────────────────────────────────────────

echo "=== Configuring Stalwart on AWS EC2 (${DOMAIN}) ==="
echo "  Postgres : ${DB_USER}@${DB_HOST}:5432/${DB_NAME}  (RDS db.t4g.micro, single-AZ)"
echo "  Redis    : ${REDIS_HOST}:${REDIS_PORT}  (local sidecar)"
echo "  Blobs    : s3://${S3_BUCKET} (ap-south-1)"
echo ""

# Catch the two things that actually go wrong here before writing a config file.
if [[ "$DB_HOST" == *:* ]]; then
  echo "ERROR: DB_HOST is '${DB_HOST}' — that looks like dbEndpoint (host:port)."
  echo "       Use 'pulumi stack output dbAddress' instead."
  exit 1
fi

echo "Checking Postgres reachability..."
timeout 5 bash -c "</dev/tcp/${DB_HOST}/5432" 2>/dev/null \
  && echo "  RDS ${DB_HOST}:5432 reachable" \
  || { echo "  ERROR: cannot reach ${DB_HOST}:5432 — check the db-sg ingress rule and that you are on the mail EC2."; exit 1; }

echo "Checking Redis sidecar..."
timeout 5 bash -c "</dev/tcp/${REDIS_HOST}/${REDIS_PORT}" 2>/dev/null \
  && echo "  Redis ${REDIS_HOST}:${REDIS_PORT} reachable" \
  || { echo "  ERROR: redis6 is not listening. Run: sudo systemctl enable --now redis6"; exit 1; }

# ─── TLS material ────────────────────────────────────────────────────────────
# Let's Encrypt (certbot, HTTP-01) can only be issued once DNS for ${DOMAIN} points
# at this box — i.e. after cutover. Until then, run on a self-signed cert so the mail
# ports come up and can be smoke-tested. MIGRATION.md has the post-cutover certbot step.
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [ -f "${CERT_DIR}/fullchain.pem" ]; then
  TLS_CERT="${CERT_DIR}/fullchain.pem"
  TLS_KEY="${CERT_DIR}/privkey.pem"
  echo "Using Let's Encrypt certificate at ${CERT_DIR}"
else
  TLS_CERT="/etc/stalwart-mail/tls/selfsigned-cert.pem"
  TLS_KEY="/etc/stalwart-mail/tls/selfsigned-key.pem"
  echo "No Let's Encrypt cert yet — generating a self-signed placeholder."
  echo "  >>> Re-run certbot AFTER DNS cutover, then re-run this script. <<<"
  sudo mkdir -p /etc/stalwart-mail/tls
  if [ ! -f "$TLS_CERT" ]; then
    sudo openssl req -x509 -newkey rsa:2048 -nodes -days 90 \
      -keyout "$TLS_KEY" -out "$TLS_CERT" \
      -subj "/CN=mail.${DOMAIN}" \
      -addext "subjectAltName=DNS:${DOMAIN},DNS:mail.${DOMAIN}" 2>/dev/null
  fi
fi
sudo chown -R stalwart:stalwart /etc/stalwart-mail/tls 2>/dev/null || true

# ─── Stalwart config ─────────────────────────────────────────────────────────
sudo mkdir -p /etc/stalwart-mail
sudo tee /etc/stalwart-mail/config.toml > /dev/null << EOF
[server]
hostname = "mail.${DOMAIN}"

# Metadata store: RDS PostgreSQL db.t4g.micro, single-AZ, private subnets.
# NOT highly available — a failover or a maintenance-window reboot is a mail outage
# of a few minutes. Backups are RDS automated (14 day retention, PITR).
[store."pg"]
type = "postgresql"
host = "${DB_HOST}"
port = 5432
database = "${DB_NAME}"
user = "${DB_USER}"
password = "${DB_PASS}"
tls = true

# Message bodies + attachments live in S3 (India data residency). Keeps the 40 GB
# root volume from being the thing that fills up.
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

# Redis for session cache / rate limiting. This is the redis6 sidecar on THIS box,
# not a managed cache — so it is loopback-only and does not survive an instance
# replacement. Nothing durable may live here.
[store."redis"]
type = "redis"
host = "${REDIS_HOST}"
port = ${REDIS_PORT}

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

# IMAP listeners.
#
# 143 is bound to LOOPBACK ONLY, and the security group (infra/aws-india.ts) does
# not open 143 to the internet at all. Reasoning: every client our customers
# actually use — Thunderbird, Outlook, Apple Mail, iOS/Android Mail — autoconfigures
# IMAP to 993 with implicit TLS, and the providers we migrate people off (Google
# Workspace, Zoho) publish 993 only, so no real client shows up expecting 143.
# A public 143 would only add a STARTTLS-stripping path to plaintext credentials.
# What remains here is for on-box smoke tests (`openssl s_client -starttls imap
# -connect 127.0.0.1:143`) — and even that refuses to take a password in the
# clear, see [imap.auth] below.
[server.listener."imap"]
bind = ["127.0.0.1:143"]
protocol = "imap"
tls.implicit = false   # STARTTLS available, never implicit on this port

[server.listener."imaps"]
bind = ["0.0.0.0:993"]
protocol = "imap"
tls.implicit = true

# Refuse LOGIN/AUTH on a connection that has not negotiated TLS. Belt and braces
# with the loopback bind above: even a future config that re-exposes 143 cannot
# leak a password in cleartext.
[imap.auth]
allow-plain-text = false

# JMAP / HTTP — loopback only. nginx terminates TLS on 443 and proxies here.
# Do NOT bind 80/443: nginx already owns them on this instance and Stalwart will
# fail to start with "address already in use".
[server.listener."http"]
bind = ["127.0.0.1:${JMAP_PORT}"]
protocol = "http"
tls.implicit = false

# TLS for the mail ports. certbot (nginx plugin) owns ACME on port 80; Stalwart just
# reads the PEM files it writes. Stalwart's own ACME client is off for the same reason.
[certificate."default"]
cert = "%{file:${TLS_CERT}}%"
private-key = "%{file:${TLS_KEY}}%"

# Outbound relay: Amazon SES Mumbai.
# NOTE: SES starts in SANDBOX (200 msgs/day, verified recipients only) until AWS
# approves production access. Sandbox rejections surface here as 554 in the queue.
[queue.outbound.next-hop."ses-relay"]
host = "email-smtp.ap-south-1.amazonaws.com"
port = 587
credentials.username = "${SES_SMTP_USER}"
credentials.password = "${SES_SMTP_PASS}"
tls = true

[queue.outbound]
next-hop = ["ses-relay"]

# DKIM signing. SES adds its own signature from the sesDkimTokens CNAMEs; this is
# our own d=${DOMAIN} signature on top. Publish the TXT record below or receivers
# will see a signature that fails to verify, which is worse than no signature.
[signature."arhamworkspace"]
algorithm = "rsa-sha256"
domain = "${DOMAIN}"
selector = "arham1"
headers = ["From", "To", "Subject", "Date", "Message-ID", "MIME-Version"]

# Admin (recovery)
[authentication.secret-fallback]
user = "admin"
EOF

sudo chown root:stalwart /etc/stalwart-mail/config.toml
sudo chmod 640 /etc/stalwart-mail/config.toml   # it holds the DB and SES passwords
echo "Config written to /etc/stalwart-mail/config.toml"

# ─── nginx vhosts ────────────────────────────────────────────────────────────
# This script owns EVERY vhost on the box, because it owns the TLS material they
# all share. cutover.sh points mail. / console. / inbox. / webmail. at this
# instance; anything not written here answers 404 the moment DNS moves.
#
#   mail.<domain>     → Stalwart JMAP on 127.0.0.1:${JMAP_PORT}
#   console.<domain>  → console-app  on 127.0.0.1:${CONSOLE_PORT}
#   inbox.<domain>    → console-app  on 127.0.0.1:${CONSOLE_PORT}  (customer-facing
#                       name; the Cloudflare OAuth redirect URI is registered here)
#   webmail.<domain>  → webui        on 127.0.0.1:${WEBUI_PORT}
#
# The three app vhosts return 502 until infra/scripts/deploy-apps.sh has run.
# That is intentional: certbot --nginx can only issue for a hostname that already
# has a server_name block, so the vhosts must exist before the apps do.
echo ""
echo "=== Writing nginx vhost for mail.${DOMAIN} ==="
sudo tee /etc/nginx/conf.d/mail-jmap.conf > /dev/null << EOF
server {
    listen 80;
    server_name mail.${DOMAIN};
    # Leave /.well-known/acme-challenge/ alone — certbot needs it post-cutover.
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name mail.${DOMAIN};

    ssl_certificate     ${TLS_CERT};
    ssl_certificate_key ${TLS_KEY};

    client_max_body_size 50m;    # attachment uploads

    location / {
        proxy_pass http://127.0.0.1:${JMAP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;   # JMAP EventSource / WS
        proxy_set_header Connection        "upgrade";
        proxy_buffering off;
        proxy_read_timeout 300s;
        # DO NOT add sub_filter in this vhost. It rewrites JMAP JSON bodies and
        # breaks the session object (and Content-Length). Rebrand in the webui, not here.
    }
}
EOF

# Console / inbox / webmail all look the same: TLS-terminating reverse proxy in
# front of a Next.js app on loopback. Same cert as the mail vhost, so the single
# certbot run below covers the lot.
write_app_vhost() {
  local file="$1" host="$2" port="$3" label="$4"
  echo "=== Writing nginx vhost for ${host} -> 127.0.0.1:${port} (${label}) ==="
  sudo tee "/etc/nginx/conf.d/${file}" > /dev/null << EOF
# ${label}. Generated by infra/scripts/configure-stalwart.sh — edits are lost on
# the next run. Returns 502 until infra/scripts/deploy-apps.sh starts the app.
server {
    listen 80;
    server_name ${host};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${host};

    ssl_certificate     ${TLS_CERT};
    ssl_certificate_key ${TLS_KEY};

    client_max_body_size 50m;    # attachment / import uploads

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_buffering off;
        # Migration imports and Next.js server actions can sit well past the
        # 60s default before they answer.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF
}

echo ""
write_app_vhost "console.conf" "console.${DOMAIN}" "${CONSOLE_PORT}" "console-app (admin/billing console)"
write_app_vhost "inbox.conf"   "inbox.${DOMAIN}"   "${CONSOLE_PORT}" "console-app (customer-facing hostname)"
write_app_vhost "webmail.conf" "webmail.${DOMAIN}" "${WEBUI_PORT}"   "webui (Bulwark webmail)"

sudo nginx -t
sudo systemctl enable nginx >/dev/null 2>&1 || true
sudo systemctl reload nginx 2>/dev/null || sudo systemctl restart nginx
echo "nginx reloaded"

# ─── DKIM key ────────────────────────────────────────────────────────────────
echo ""
echo "=== Generating DKIM key ==="
sudo -u stalwart stalwart-mail --dkim-generate \
  --domain "${DOMAIN}" \
  --selector "arham1" \
  --output /etc/stalwart-mail/dkim-arham1.pem 2>/dev/null || \
  sudo openssl genrsa -out /etc/stalwart-mail/dkim-arham1.pem 2048 2>/dev/null

DKIM_PUBLIC=$(sudo openssl rsa -in /etc/stalwart-mail/dkim-arham1.pem -pubout 2>/dev/null \
  | grep -v "PUBLIC KEY" | tr -d '\n')

echo ""
echo "=== DKIM DNS Record (add to Cloudflare NOW) ==="
echo "Type: TXT"
echo "Name: arham1._domainkey.${DOMAIN}"
echo "Value: v=DKIM1; k=rsa; p=${DKIM_PUBLIC}"
echo ""

# ─── Start ───────────────────────────────────────────────────────────────────
sudo systemctl restart stalwart-mail
sleep 3
sudo systemctl status stalwart-mail --no-pager -l 2>/dev/null | head -20 || true

echo ""
echo "=== Stalwart configured and running ==="
echo "JMAP (local)  : curl -s http://127.0.0.1:${JMAP_PORT}/jmap/session"
echo "JMAP (public) : https://mail.${DOMAIN}/jmap/session  (works once DNS points here)"
echo "Admin user    : admin  (password from STALWART_RECOVERY_ADMIN — rotate it after cutover)"
echo ""
echo "nginx vhosts written: mail. console. inbox. webmail."
echo "  console./inbox./webmail. answer 502 until the apps are deployed:"
echo "    bash infra/scripts/deploy-apps.sh     (run from the repo on your laptop)"
echo ""
echo "IMAP: 993 only (implicit TLS). 143 is loopback-only and not in the security"
echo "group — mail clients must be configured for 993/SSL, not 143/STARTTLS."
echo ""
echo "Still to do: publish the DKIM TXT above, and re-run certbot after DNS cutover"
echo "for ALL hostnames (one cert, one nginx reload):"
echo "  sudo certbot --nginx -d ${DOMAIN} -d mail.${DOMAIN} \\"
echo "               -d console.${DOMAIN} -d inbox.${DOMAIN} -d webmail.${DOMAIN}"
echo "  sudo bash \$0    # re-run this script so the mail ports pick up the real cert"
