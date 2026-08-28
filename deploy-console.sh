#!/bin/bash
# Deploy console-app to production server
# Run locally: bash deploy-console.sh
#
# Secrets are loaded from console-app/.env.production.secrets (gitignored).
# Copy console-app/.env.production.example to console-app/.env.production.secrets and fill in values.
set -e

SERVER=206.189.136.89
SSH_KEY=~/.ssh/id_ed25519
REMOTE_DIR=/home/ubuntu/arham-console
SECRETS_FILE="$(dirname "$0")/console-app/.env.production.secrets"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "ERROR: $SECRETS_FILE not found."
  echo "Copy console-app/.env.production.example to console-app/.env.production.secrets and fill in values."
  exit 1
fi

# Load secrets into env
set -a; source "$SECRETS_FILE"; set +a

echo "=== Packing console-app ==="
tar --exclude='console-app/node_modules' \
    --exclude='console-app/.next' \
    --exclude='console-app/.git' \
    --exclude='console-app/.env.production.secrets' \
    -czf /tmp/console-app.tar.gz console-app/

echo "=== Uploading to server ==="
scp -i $SSH_KEY /tmp/console-app.tar.gz ubuntu@$SERVER:/tmp/console-app.tar.gz

ssh -i $SSH_KEY ubuntu@$SERVER bash -s << REMOTE
set -e
echo "--- Deploying on server ---"

mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

# Extract (overwrite)
tar -xzf /tmp/console-app.tar.gz --strip-components=1

# Write env file from sourced secrets
cat > .env.local << 'ENV'
DATABASE_URL=${DATABASE_URL}
JMAP_URL=${JMAP_URL}
JMAP_ADMIN_AUTH=${JMAP_ADMIN_AUTH}
JWT_SECRET=${JWT_SECRET}
RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID}
RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET}
RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET}
MIGRATION_PG_URL=${MIGRATION_PG_URL}
REDIS_URL=${REDIS_URL}
MIGRATION_ENCRYPTION_KEY=${MIGRATION_ENCRYPTION_KEY}
NODE_ENV=production
ENV

echo "Created .env.local"

# Install deps
npm install --production=false

# Build
npm run build

# PM2
if command -v pm2 &>/dev/null; then
  pm2 describe arham-console &>/dev/null && pm2 restart arham-console || \
  pm2 start npm --name arham-console -- start
  pm2 save
fi

sleep 3
echo ""
echo "=== Console app deployed! ==="
echo "Check: https://console.arhamworkspace.tech"
REMOTE

echo ""
rm -f /tmp/console-app.tar.gz
echo "Done."
