#!/bin/bash
# DNS cutover: DO → AWS
# Run ONLY when ready for ~5 min maintenance window
set -e
set -o pipefail

DO_SERVER="206.189.136.89"
DO_SSH_KEY="${DO_SSH_KEY:-$HOME/.ssh/id_ed25519}"
AWS_EC2_IP="${AWS_EC2_IP:?Set AWS_EC2_IP from pulumi stack output mailIp}"
AWS_SSH_KEY="${AWS_SSH_KEY:-$HOME/.ssh/arham-aws-key.pem}"
# A literal ~ inside a quoted value is not expanded by the shell; ssh/scp
# would then look for a directory actually named "~". Expand it ourselves.
DO_SSH_KEY="${DO_SSH_KEY/#\~/$HOME}"
AWS_SSH_KEY="${AWS_SSH_KEY/#\~/$HOME}"
# RDS PostgreSQL. Use dbAddress (bare hostname) — dbEndpoint is host:port.
AWS_PG_HOST="${AWS_PG_HOST:?Set AWS_PG_HOST from pulumi stack output dbAddress}"
AWS_PG_PASS="${AWS_PG_PASS:?Set AWS_PG_PASS — the dbPassword from pulumi config}"
AWS_PG_PORT="5432"
AWS_PG_USER="arhamapp"
DOMAIN="${DOMAIN:-arhamworkspace.tech}"

if [[ "$AWS_PG_HOST" == *:* ]]; then
  echo "ERROR: AWS_PG_HOST is '${AWS_PG_HOST}' — that is dbEndpoint (host:port)."
  echo "       Use: pulumi stack output dbAddress"
  exit 1
fi

# PGPASSWORD + flags, so a password with URL-unsafe characters still works.
export PGPASSWORD="${AWS_PG_PASS}"
export PGSSLMODE="require"
aws_psql() { psql -h "$AWS_PG_HOST" -p "$AWS_PG_PORT" -U "$AWS_PG_USER" -d "$1"; }

echo "================================================"
echo "  CUTOVER — DO → AWS"
echo "  Estimated downtime: 3-5 minutes"
echo "================================================"
read -p "Type YES to proceed: " confirm
[ "$confirm" = "YES" ] || { echo "Aborted."; exit 0; }

# 1. Stop DO Stalwart (maintenance mode starts)
echo ""
echo "[1/5] Stopping DO Stalwart..."
ssh -i "${DO_SSH_KEY}" ubuntu@${DO_SERVER} "sudo systemctl stop flux"
echo "DO mail server stopped"

# 2. Final PostgreSQL sync (catch any writes during migration window)
echo ""
echo "[2/5] Final PostgreSQL sync..."
DO_PG_URL="postgresql://USER:PASSWORD@DO-HOST:25060"
pg_dump "${DO_PG_URL}/arham-console?sslmode=require"   | aws_psql arham-console
pg_dump "${DO_PG_URL}/arham-migration?sslmode=require" | aws_psql arham-migration
echo "PostgreSQL synced"

# 3. Final mail data sync (just the delta — seconds)
echo ""
echo "[3/5] Final mail data sync..."
# rsync cannot go remote→remote (and only honours one -e); stream tar through here.
ssh -i "${DO_SSH_KEY}" ubuntu@${DO_SERVER} "sudo tar -czf - -C /var/lib/flux/data ." \
  | ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "sudo tar -xzf - -C /var/lib/stalwart-mail/data"
echo "Mail data synced"

# 4. Start AWS Stalwart
echo ""
echo "[4/5] Starting AWS Stalwart..."
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "sudo systemctl start stalwart-mail"
sleep 5
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "sudo systemctl status stalwart-mail --no-pager | head -5"

# 5. Verify AWS endpoints respond
echo ""
echo "[5/5] Verifying AWS endpoints..."
# Stalwart's HTTP listener is loopback-only; nginx terminates TLS on 443. Force the
# hostname so nginx picks the mail vhost, and -k because the cert is still self-signed
# until certbot runs below (DNS has not moved yet at this point).
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} \
  "curl -sf http://127.0.0.1:8080/jmap/session > /dev/null" && \
  echo "JMAP (stalwart, loopback): OK ✅" || echo "JMAP (stalwart, loopback): FAILED ❌ — journalctl -u stalwart-mail"
curl -sfk --resolve "mail.${DOMAIN}:443:${AWS_EC2_IP}" "https://mail.${DOMAIN}/jmap/session" > /dev/null && \
  echo "JMAP (via nginx 443):      OK ✅" || echo "JMAP (via nginx 443):      FAILED ❌ — nginx -t / journalctl -u nginx"

echo ""
echo "================================================"
echo "  NOW: Update DNS in Cloudflare"
echo "================================================"
echo ""
echo "Set these A records to: ${AWS_EC2_IP}"
echo "  arhamworkspace.tech"
echo "  mail.arhamworkspace.tech"
echo "  console.arhamworkspace.tech"
echo "  inbox.arhamworkspace.tech"
echo "  webmail.arhamworkspace.tech"
echo ""
echo "MX record: mail.arhamworkspace.tech (priority 10)"
echo ""
echo "DNS propagates in ~60 seconds (TTL was already lowered to 60s)."
echo ""
echo "THEN, on the mail EC2, issue the real certificate (HTTP-01 only works once DNS"
echo "points here — until now everything has been on a self-signed placeholder):"
echo "  ssh -i ${AWS_SSH_KEY} ec2-user@${AWS_EC2_IP}"
echo "  sudo certbot --nginx -d ${DOMAIN} -d mail.${DOMAIN}"
echo "  # then re-run configure-stalwart.sh so the mail ports pick up the new cert"
echo ""
echo "After DNS + certbot, verify:"
echo "  curl https://mail.${DOMAIN}/jmap/session"
echo "  curl https://console.${DOMAIN}/api/health"
echo "  openssl s_client -connect mail.${DOMAIN}:993 -servername mail.${DOMAIN} </dev/null | head -5"
echo ""
echo "Monitor for 24h, then cancel DO services."
