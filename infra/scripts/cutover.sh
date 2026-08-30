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
# ON_ERROR_STOP is the whole point: without it psql happily reports success after
# every statement in the dump has failed, and this script would then tell you to
# move DNS onto an empty database.
aws_psql() { psql -v ON_ERROR_STOP=1 -h "$AWS_PG_HOST" -p "$AWS_PG_PORT" -U "$AWS_PG_USER" -d "$1" "${@:2}"; }

echo "================================================"
echo "  CUTOVER — DO → AWS"
echo "  Estimated downtime: 3-5 minutes"
echo "================================================"
read -p "Type YES to proceed: " confirm
[ "$confirm" = "YES" ] || { echo "Aborted."; exit 0; }

# Nothing below may fail silently: this is the window where mail is down, and a
# half-applied cutover is worse than an aborted one.

# 1. Stop DO Stalwart (maintenance mode starts)
echo ""
echo "[1/5] Stopping DO Stalwart..."
ssh -i "${DO_SSH_KEY}" ubuntu@${DO_SERVER} "sudo systemctl stop flux"
echo "DO mail server stopped"

# 2. Final PostgreSQL sync (catch any writes during migration window)
echo ""
echo "[2/5] Final PostgreSQL sync..."
# Override with DO_PG_URL once the DO password has been rotated (post-cutover
# checklist item) rather than editing this line under time pressure.
DO_PG_URL="${DO_PG_URL:-postgresql://USER:PASSWORD@DO-HOST:25060}"

# --clean --if-exists: RDS already holds the bulk copy from migrate-from-do.sh, so
#   a plain restore would hit "relation already exists" on every CREATE and then
#   append duplicate rows through the COPYs. Drop and recreate instead.
# --no-owner --no-acl: DO's roles (doadmin et al) do not exist on RDS, and with
#   ON_ERROR_STOP set those GRANT/OWNER TO lines would abort an otherwise fine
#   restore.
# --single-transaction: all of it or none of it. A failure leaves the pre-cutover
#   data intact instead of a half-dropped schema.
DUMP_FLAGS=(--clean --if-exists --no-owner --no-acl)
pg_dump "${DUMP_FLAGS[@]}" "${DO_PG_URL}/arham-console?sslmode=require"   | aws_psql arham-console   --single-transaction
pg_dump "${DUMP_FLAGS[@]}" "${DO_PG_URL}/arham-migration?sslmode=require" | aws_psql arham-migration --single-transaction
echo "PostgreSQL synced (both databases restored without error)"

# 3. Final mail data sync (just the delta — seconds)
echo ""
echo "[3/5] Final mail data sync..."
# rsync cannot go remote→remote (and only honours one -e); stream tar through here.
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} \
  "sudo mkdir -p /var/lib/stalwart-mail/data && sudo chown stalwart:stalwart /var/lib/stalwart-mail/data"
# set -o pipefail (top of file) is what makes a failure on EITHER side of this
# pipe abort the script rather than reporting a successful sync of nothing.
ssh -i "${DO_SSH_KEY}" ubuntu@${DO_SERVER} "sudo tar -czf - -C /var/lib/flux/data ." \
  | ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "sudo tar -xzf - -C /var/lib/stalwart-mail/data"
echo "Mail data synced"

# 4. Start AWS Stalwart
echo ""
echo "[4/5] Starting AWS Stalwart..."
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "sudo systemctl start stalwart-mail"
sleep 5
# is-active exits non-zero if it did not come up — do not carry on to the DNS
# instructions with a dead mail server.
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "systemctl is-active --quiet stalwart-mail" || {
  echo "ERROR: stalwart-mail did not start on the AWS box. DO NOT MOVE DNS."
  echo "       ssh -i ${AWS_SSH_KEY} ec2-user@${AWS_EC2_IP} 'journalctl -u stalwart-mail -n 100 --no-pager'"
  echo "       Roll back: ssh -i ${DO_SSH_KEY} ubuntu@${DO_SERVER} 'sudo systemctl start flux'"
  exit 1
}
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "sudo systemctl status stalwart-mail --no-pager | head -5"

# 5. Verify AWS endpoints respond
echo ""
echo "[5/5] Verifying AWS endpoints..."
# Stalwart's HTTP listener is loopback-only; nginx terminates TLS on 443. Force the
# hostname so nginx picks the mail vhost, and -k because the cert is still self-signed
# until certbot runs below (DNS has not moved yet at this point).
VERIFY_FAILED=0
check() {   # check <label> <command...>
  if "${@:2}" > /dev/null 2>&1; then
    echo "  $1: OK"
  else
    echo "  $1: FAILED"
    VERIFY_FAILED=1
  fi
}
check "JMAP  (stalwart, loopback)" \
  ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "curl -sf http://127.0.0.1:8080/jmap/session -o /dev/null"
check "JMAP  (mail.    via nginx)" \
  curl -sfk --resolve "mail.${DOMAIN}:443:${AWS_EC2_IP}"    "https://mail.${DOMAIN}/jmap/session"
# The app vhosts exist from configure-stalwart.sh and are only live once
# deploy-apps.sh has run. A 404/502 here means the hostnames cutover is about to
# point at the box would answer with an error page.
check "console (console. via nginx)" \
  curl -sfk --resolve "console.${DOMAIN}:443:${AWS_EC2_IP}" "https://console.${DOMAIN}/"
check "console (inbox.   via nginx)" \
  curl -sfk --resolve "inbox.${DOMAIN}:443:${AWS_EC2_IP}"   "https://inbox.${DOMAIN}/"
check "webui   (webmail. via nginx)" \
  curl -sfk --resolve "webmail.${DOMAIN}:443:${AWS_EC2_IP}" "https://webmail.${DOMAIN}/"

if [ "$VERIFY_FAILED" -ne 0 ]; then
  echo ""
  echo "================================================"
  echo "  VERIFICATION FAILED — DO NOT MOVE DNS"
  echo "================================================"
  echo "Mail is currently down on BOTH sides. Either fix the failure above and"
  echo "re-run the verification, or roll back to DigitalOcean right now:"
  echo "  ssh -i ${DO_SSH_KEY} ubuntu@${DO_SERVER} 'sudo systemctl start flux'"
  echo ""
  echo "Where to look:"
  echo "  JMAP     : journalctl -u stalwart-mail -n 100 --no-pager"
  echo "  vhosts   : sudo nginx -t; ls /etc/nginx/conf.d/   (configure-stalwart.sh writes them)"
  echo "  console  : pm2 status; pm2 logs arham-console --lines 100"
  echo "  webui    : pm2 logs arham-webui --lines 100"
  echo "  apps not deployed at all? → bash infra/scripts/deploy-apps.sh"
  exit 1
fi

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
echo "  sudo certbot --nginx -d ${DOMAIN} -d mail.${DOMAIN} \\"
echo "               -d console.${DOMAIN} -d inbox.${DOMAIN} -d webmail.${DOMAIN}"
echo "  # then re-run configure-stalwart.sh so the mail ports pick up the new cert"
echo ""
echo "After DNS + certbot, verify:"
echo "  curl https://mail.${DOMAIN}/jmap/session"
echo "  curl https://console.${DOMAIN}/api/health"
echo "  curl -I https://inbox.${DOMAIN}/"
echo "  curl -I https://webmail.${DOMAIN}/"
echo "  openssl s_client -connect mail.${DOMAIN}:993 -servername mail.${DOMAIN} </dev/null | head -5"
echo ""
echo "Monitor for 24h, then cancel DO services."
