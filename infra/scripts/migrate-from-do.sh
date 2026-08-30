#!/bin/bash
# Migrate from DigitalOcean to AWS Mumbai
# Run locally AFTER AWS infra is provisioned and Stalwart is configured
# Usage: bash migrate-from-do.sh
#
# Target stack: one EC2 (Stalwart + nginx + local redis6 sidecar), one RDS
# PostgreSQL db.t4g.micro, S3 for blobs, SES for outbound.
# No Aurora, no ElastiCache, no ALB — do not look for those outputs.
set -e
set -o pipefail

# ─── Config — fill from pulumi stack output + your DO creds ──────────────────
DO_SERVER="206.189.136.89"
DO_SSH_KEY="${DO_SSH_KEY:-$HOME/.ssh/id_ed25519}"
AWS_EC2_IP="${AWS_EC2_IP:?Set AWS_EC2_IP from pulumi stack output mailIp}"
AWS_SSH_KEY="${AWS_SSH_KEY:-$HOME/.ssh/arham-aws-key.pem}"
# A literal ~ inside a quoted value is not expanded by the shell; ssh/scp
# would then look for a directory actually named "~". Expand it ourselves.
DO_SSH_KEY="${DO_SSH_KEY/#\~/$HOME}"
AWS_SSH_KEY="${AWS_SSH_KEY/#\~/$HOME}"

# DO PostgreSQL (direct port, not PgBouncer, for pg_dump)
DO_PG_URL="postgresql://USER:PASSWORD@DO-HOST:25060"
# AWS RDS PostgreSQL. dbAddress is the BARE hostname; dbEndpoint is host:port and
# breaks every -h flag and connection URL below.
AWS_PG_HOST="${AWS_PG_HOST:?Set AWS_PG_HOST from pulumi stack output dbAddress}"
AWS_PG_PASS="${AWS_PG_PASS:?Set AWS_PG_PASS — the dbPassword from pulumi config}"
AWS_PG_PORT="5432"
AWS_PG_USER="arhamapp"

# Redis is the local redis6 sidecar on the mail EC2 — there is no ElastiCache and no
# Pulumi output for it. The console app runs on that same box, so it uses loopback.
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$AWS_PG_HOST" == *:* ]]; then
  echo "ERROR: AWS_PG_HOST is '${AWS_PG_HOST}' — that is dbEndpoint (host:port)."
  echo "       Use: pulumi stack output dbAddress"
  exit 1
fi

# The console app receives DATABASE_URL as a URL, so a password containing / @ : or #
# silently produces a broken connection string. Fail loudly instead.
case "$AWS_PG_PASS" in
  *[!A-Za-z0-9._~-]*)
    echo "ERROR: AWS_PG_PASS has characters that must be percent-encoded in a URL."
    echo "       Regenerate it URL-safe (RDS also rejects / @ \" and space):"
    echo "         pulumi config set --secret dbPassword \"\$(openssl rand -hex 24)\""
    echo "         pulumi up --stack aws-india"
    exit 1 ;;
esac

# AWS side uses PGPASSWORD + flags rather than a URL, so the password is never parsed.
export PGPASSWORD="${AWS_PG_PASS}"
export PGSSLMODE="require"
aws_psql() { local db="$1"; shift; psql -h "$AWS_PG_HOST" -p "$AWS_PG_PORT" -U "$AWS_PG_USER" -d "$db" "$@"; }

echo "================================================"
echo "  Arham Workspace — DO → AWS Migration"
echo "================================================"
echo "DO server:  ${DO_SERVER}"
echo "AWS server: ${AWS_EC2_IP}"
echo "AWS RDS:    ${AWS_PG_HOST}:${AWS_PG_PORT}"
echo ""

# Step 1: Migrate PostgreSQL
echo "=== Step 1/4: PostgreSQL migration (DO managed PG → RDS) ==="
echo "Dumping from DO PostgreSQL..."

pg_dump "${DO_PG_URL}/arham-console?sslmode=require"    > /tmp/arham_console.sql
pg_dump "${DO_PG_URL}/arham-migration?sslmode=require"  > /tmp/arham_migration.sql
echo "Dumps complete: $(wc -l < /tmp/arham_console.sql) lines (console), $(wc -l < /tmp/arham_migration.sql) lines (migration)"

echo "Importing into RDS..."
aws_psql arham -c "CREATE DATABASE \"arham-console\";"   2>/dev/null || true
aws_psql arham -c "CREATE DATABASE \"arham-migration\";" 2>/dev/null || true
aws_psql arham-console    < /tmp/arham_console.sql
aws_psql arham-migration  < /tmp/arham_migration.sql
rm -f /tmp/arham_console.sql /tmp/arham_migration.sql
echo "PostgreSQL migrated ✅"

# Step 2: Initial mail data sync (while DO still running — no downtime yet)
echo ""
echo "=== Step 2/4: Initial mail data sync (DO still live) ==="
echo "This syncs the bulk of data. Run cutover.sh for the final delta sync."
# rsync cannot do remote→remote (and only honours one -e), so stream tar through here.
# NOTE: on AWS the Stalwart message store is Postgres + S3, not this local directory.
# What this carries over is on-disk state — DKIM keys, ACME cache, any local RocksDB
# left from the DO install. Mailbox contents move via the IMAP migration workers.
ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} \
  "sudo mkdir -p /var/lib/stalwart-mail/data && sudo chown stalwart:stalwart /var/lib/stalwart-mail/data"
ssh -i "${DO_SSH_KEY}" ubuntu@${DO_SERVER} "sudo tar -czf - -C /var/lib/flux/data ." \
  | ssh -i "${AWS_SSH_KEY}" ec2-user@${AWS_EC2_IP} "sudo tar -xzf - -C /var/lib/stalwart-mail/data"

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

for v in JMAP_ADMIN_AUTH JWT_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET \
         RAZORPAY_WEBHOOK_SECRET MIGRATION_ENCRYPTION_KEY; do
  if [ -z "${!v:-}" ]; then echo "ERROR: $v is not set in $SECRETS_FILE"; exit 1; fi
done

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
DATABASE_URL=postgresql://${AWS_PG_USER}:${AWS_PG_PASS}@${AWS_PG_HOST}:${AWS_PG_PORT}/arham-console?sslmode=require
# Stalwart's HTTP listener is loopback-only on this box; nginx fronts it on 443.
JMAP_URL=http://127.0.0.1:8080
JMAP_ADMIN_AUTH=${JMAP_ADMIN_AUTH}
JWT_SECRET=${JWT_SECRET}
RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID}
RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET}
RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET}
MIGRATION_PG_URL=postgresql://${AWS_PG_USER}:${AWS_PG_PASS}@${AWS_PG_HOST}:${AWS_PG_PORT}/arham-migration?sslmode=require
# Local redis6 sidecar on this instance — not ElastiCache.
REDIS_URL=redis://${REDIS_HOST}:6379
MIGRATION_ENCRYPTION_KEY=${MIGRATION_ENCRYPTION_KEY}
NODE_ENV=production
ENV
chmod 600 .env.local

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
