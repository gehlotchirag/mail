#!/bin/bash
# DNS cutover: DO → AWS
# Run ONLY when ready for ~5 min maintenance window
set -e

DO_SERVER="206.189.136.89"
DO_SSH_KEY="~/.ssh/id_ed25519"
AWS_EC2_IP="${AWS_EC2_IP:?Set AWS_EC2_IP}"
AWS_SSH_KEY="${AWS_SSH_KEY:-~/.ssh/arham-aws-key.pem}"
AWS_PG_HOST="${AWS_PG_HOST:?Set AWS_PG_HOST}"
AWS_PG_PASS="${AWS_PG_PASS:?Set AWS_PG_PASS}"

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
AWS_PG_URL="postgresql://arhamapp:${AWS_PG_PASS}@${AWS_PG_HOST}:5432"
pg_dump "${DO_PG_URL}/arham-console"   | psql "${AWS_PG_URL}/arham-console"
pg_dump "${DO_PG_URL}/arham-migration" | psql "${AWS_PG_URL}/arham-migration"
echo "PostgreSQL synced"

# 3. Final mail data sync (just the delta — seconds)
echo ""
echo "[3/5] Final mail data sync..."
rsync -avz --delete \
  -e "ssh -i ${DO_SSH_KEY}" \
  ubuntu@${DO_SERVER}:/var/lib/flux/data/ \
  -e "ssh -i ${AWS_SSH_KEY}" \
  ec2-user@${AWS_EC2_IP}:/var/lib/stalwart-mail/data/
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
curl -sf "https://${AWS_EC2_IP}/jmap/session" -k > /dev/null && \
  echo "JMAP: OK ✅" || echo "JMAP: FAILED ❌ — check Stalwart logs"

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
echo "After DNS is updated, verify:"
echo "  curl https://mail.arhamworkspace.tech/jmap/session"
echo "  curl https://console.arhamworkspace.tech/api/health"
echo ""
echo "Monitor for 24h, then cancel DO services."
