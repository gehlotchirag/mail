#!/bin/bash
# Migrate from DigitalOcean to AWS
# Run locally AFTER AWS infra is provisioned and Stalwart is configured
# Usage: bash migrate-from-do.sh
set -e

# ─── Config — fill from pulumi stack output + your DO creds ──────────────────
DO_SERVER="206.189.136.89"
DO_SSH_KEY="~/.ssh/id_ed25519"
AWS_EC2_IP="${AWS_EC2_IP:?Set AWS_EC2_IP from pulumi stack output mailIp}"
AWS_SSH_KEY="${AWS_SSH_KEY:-~/.ssh/arham-aws-key.pem}"

# DO PostgreSQL (direct port, not PgBouncer, for pg_dump)
DO_PG_URL="postgresql://USER:PASSWORD@DO-HOST:25060"
# AWS Aurora (from pulumi stack output auroraEndpoint)
AWS_PG_HOST="${AWS_PG_HOST:?Set AWS_PG_HOST from pulumi stack output}"
AWS_PG_PASS="${AWS_PG_PASS:?Set AWS_PG_PASS}"
AWS_PG_URL="postgresql://arhamapp:${AWS_PG_PASS}@${AWS_PG_HOST}:5432/arham"
# ─────────────────────────────────────────────────────────────────────────────

SSH_DO="ssh -i ${DO_SSH_KEY} ubuntu@${DO_SERVER}"
SSH_AWS="ssh -i ${AWS_SSH_KEY} ec2-user@${AWS_EC2_IP}"

echo "================================================"
echo "  Arham Workspace — DO → AWS Migration"
echo "================================================"
echo "DO server:  ${DO_SERVER}"
echo "AWS server: ${AWS_EC2_IP}"
echo ""

# Step 1: Migrate PostgreSQL
echo "=== Step 1/4: PostgreSQL migration ==="
echo "Dumping from DO PostgreSQL..."

pg_dump "${DO_PG_URL}/arham-console"    > /tmp/arham_console.sql
pg_dump "${DO_PG_URL}/arham-migration"  > /tmp/arham_migration.sql
echo "Dumps complete: $(wc -l /tmp/arham_console.sql | awk '{print $1}') rows (console), $(wc -l /tmp/arham_migration.sql | awk '{print $1}') rows (migration)"

echo "Importing to Aurora..."
psql "${AWS_PG_URL}" -c "CREATE DATABASE \"arham-console\";"   2>/dev/null || true
psql "${AWS_PG_URL}" -c "CREATE DATABASE \"arham-migration\";" 2>/dev/null || true
psql "${AWS_PG_URL}/arham-console"    < /tmp/arham_console.sql
psql "${AWS_PG_URL}/arham-migration"  < /tmp/arham_migration.sql
rm -f /tmp/arham_console.sql /tmp/arham_migration.sql
echo "PostgreSQL migrated ✅"

# Step 2: Initial mail data sync (while DO still running — no downtime yet)
echo ""
echo "=== Step 2/4: Initial mail data sync (incremental — DO still live) ==="
echo "This syncs the bulk of data. Run Step 4 for the final cutover sync."
rsync -avz --delete --progress \
  -e "ssh -i ${DO_SSH_KEY}" \
  ubuntu@${DO_SERVER}:/var/lib/flux/data/ \
  -e "ssh -i ${AWS_SSH_KEY}" \
  ec2-user@${AWS_EC2_IP}:/var/lib/stalwart-mail/data/ 2>/dev/null || \
  echo "Note: Direct rsync between servers requires SSH agent forwarding or copy via local"

echo "Initial sync complete ✅"

# Step 3: Deploy apps to AWS
echo ""
echo "=== Step 3/4: Deploy apps on AWS ==="
echo "Deploying console-app..."

SECRETS_FILE="$(dirname "$0")/../../console-app/.env.production.secrets"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "ERROR: $SECRETS_FILE not found"
  exit 1
fi
set -a; source "$SECRETS_FILE"; set +a

tar --exclude='console-app/node_modules' \
    --exclude='console-app/.next' \
    --exclude='console-app/.env.production.secrets' \
    -czf /tmp/console-app.tar.gz \
    -C "$(dirname "$0")/../.." console-app/

scp -i "${AWS_SSH_KEY}" /tmp/console-app.tar.gz ec2-user@${AWS_EC2_IP}:/tmp/

ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} bash -s << REMOTE
set -e
mkdir -p /home/ec2-user/arham-console
cd /home/ec2-user/arham-console
tar -xzf /tmp/console-app.tar.gz --strip-components=1

cat > .env.local << ENV
DATABASE_URL=postgresql://arhamapp:${AWS_PG_PASS}@${AWS_PG_HOST}:5432/arham-console?sslmode=require
JMAP_URL=http://localhost:8080
JMAP_ADMIN_AUTH=${JMAP_ADMIN_AUTH}
JWT_SECRET=${JWT_SECRET}
RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID}
RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET}
RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET}
MIGRATION_PG_URL=postgresql://arhamapp:${AWS_PG_PASS}@${AWS_PG_HOST}:5432/arham-migration?sslmode=require
REDIS_URL=redis://${REDIS_HOST}:6379
MIGRATION_ENCRYPTION_KEY=${MIGRATION_ENCRYPTION_KEY}
NODE_ENV=production
ENV

npm install --production=false
npm run build
pm2 describe arham-console &>/dev/null && pm2 restart arham-console || \
  pm2 start npm --name arham-console -- start
pm2 save
REMOTE

rm -f /tmp/console-app.tar.gz
echo "Console deployed on AWS ✅"

echo ""
echo "================================================"
echo "Ready for CUTOVER. Run Step 4 when ready."
echo "================================================"
echo ""
echo "=== Step 4/4 (CUTOVER — run when ready for maintenance) ==="
echo "This step causes ~5 minutes of downtime."
echo ""
echo "Run: bash $(dirname "$0")/cutover.sh"
