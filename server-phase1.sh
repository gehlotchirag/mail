#!/bin/bash
# Phase 1 server tasks — run once SSH is unblocked
# Locally: bash server-phase1.sh
set -e

SERVER=206.189.136.89
SSH_KEY=~/.ssh/id_ed25519
SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=no ubuntu@$SERVER"

echo "=== Testing SSH ==="
$SSH "echo SSH OK" || { echo "SSH still blocked. Unban IP first."; exit 1; }

echo ""
echo "=== 1. Fix hostname ==="
$SSH "sudo hostnamectl set-hostname mail.arhamworkspace.tech && hostname"

echo ""
echo "=== 2. Binary swap: Stalwart v0.16.19 ==="
$SSH bash -s << 'STEP2'
set -e
BINARY=/home/ubuntu/flux-mail/target/debug/flux

# Download binary if not already in /tmp
if [ ! -f /tmp/stalwart ]; then
  echo "Downloading Stalwart v0.16.19 musl binary..."
  curl -fsSL -o /tmp/stalwart-mail.tar.gz \
    "https://github.com/stalwartlabs/mail-server/releases/download/v0.16.19/stalwart-x86_64-unknown-linux-musl.tar.gz"
  cd /tmp && tar -xzf stalwart-mail.tar.gz stalwart && mv stalwart /tmp/stalwart
  chmod +x /tmp/stalwart
  rm -f /tmp/stalwart-mail.tar.gz
  echo "Downloaded successfully"
else
  echo "Found existing /tmp/stalwart"
fi
ls -lh /tmp/stalwart

echo "Stopping flux service..."
sudo systemctl stop flux

echo "Backing up old binary..."
sudo cp $BINARY ${BINARY}.v0164.backup 2>/dev/null || true

echo "Installing new binary..."
sudo cp /tmp/stalwart $BINARY
sudo chmod +x $BINARY

echo "Starting flux service..."
sudo systemctl start flux
sleep 5

echo "Flux status:"
sudo systemctl status flux --no-pager -l | head -20

echo "Version check:"
$BINARY --version 2>/dev/null || true
STEP2

echo ""
echo "=== 3. Configure TLS on mail ports ==="
$SSH bash -s << 'STEP3'
set -e
# Let's Encrypt certs should be at:
CERT=/etc/letsencrypt/live/mail.arhamworkspace.tech/fullchain.pem
KEY=/etc/letsencrypt/live/mail.arhamworkspace.tech/privkey.pem

if [ ! -f "$CERT" ]; then
  echo "Installing certbot and getting cert..."
  sudo apt-get install -y certbot
  # Stop nginx temporarily for standalone mode
  sudo systemctl stop nginx
  sudo certbot certonly --standalone \
    -d mail.arhamworkspace.tech \
    --non-interactive --agree-tos \
    -m admin@arhamworkspace.tech \
    --no-eff-email
  sudo systemctl start nginx
fi

echo "Cert found: $CERT"
ls -lh $CERT $KEY

# Reload nginx (certs may have changed)
sudo nginx -t && sudo systemctl reload nginx
echo "TLS certs ready"
STEP3

echo ""
echo "=== 4. Update workers .env ==="
$SSH bash -s << 'STEP4'
set -e
WORKERS_ENV=/home/ubuntu/workers/.env

# Update to PgBouncer pool
sed -i 's|:25060/migration|:25061/arham-migration-pool|' $WORKERS_ENV
echo "Updated MIGRATION_PG_URL to PgBouncer pool"

# Remove NODE_TLS_REJECT_UNAUTHORIZED if present
sed -i '/NODE_TLS_REJECT_UNAUTHORIZED/d' $WORKERS_ENV
echo "Removed NODE_TLS_REJECT_UNAUTHORIZED"

cat $WORKERS_ENV
STEP4

echo ""
echo "=== 5. Restart workers via PM2 ==="
$SSH bash -s << 'STEP5'
cd /home/ubuntu/workers
# Update env, restart workers
pm2 restart all --update-env || pm2 start ecosystem.config.js
pm2 save
pm2 status
STEP5

echo ""
echo "=== 6. Deploy updated landing pages ==="
scp -i $SSH_KEY \
  /Users/satyaprakashkushwaha/Documents/Arham\ email/landing-pages/arhamworkspace/index.html \
  ubuntu@$SERVER:/var/www/arhamworkspace/index.html

scp -i $SSH_KEY \
  /Users/satyaprakashkushwaha/Documents/Arham\ email/landing-pages/inbox/index.html \
  ubuntu@$SERVER:/var/www/inbox/index.html

echo "Landing pages deployed"

echo ""
echo "=== 7. Deploy console-app ==="
bash /Users/satyaprakashkushwaha/Documents/Arham\ email/deploy-console.sh

echo ""
echo "================================================"
echo "Phase 1 complete!"
echo "================================================"
echo "Verify:"
echo "  Mail:    curl -s https://mail.arhamworkspace.tech/jmap/ | head -5"
echo "  Console: curl -s https://console.arhamworkspace.tech/api/health"
echo "  Landing: curl -I https://arhamworkspace.tech"
echo "  Inbox:   curl -I https://inbox.arhamworkspace.tech"
