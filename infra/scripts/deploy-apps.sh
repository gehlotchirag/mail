#!/bin/bash
# Deploy the product onto the AWS mail EC2.
#
# Run this LOCALLY, from a checkout of the repo, AFTER `pulumi up` and AFTER
# configure-stalwart.sh has run on the instance (it writes the nginx vhosts these
# apps sit behind).
#
#   bash infra/scripts/deploy-apps.sh
#
# The EC2 user_data bootstrap installs Stalwart, Redis, nginx, Node and PM2 — a
# mail server with no product on it. This script is the other half: it ships the
# three Node applications, writes their environment files, builds them and starts
# them under PM2.
#
#   console-app  → PM2 "arham-console", 127.0.0.1:3002
#                  fronted by console.<domain> AND inbox.<domain>
#   webui        → PM2 "arham-webui",   127.0.0.1:3000
#                  fronted by webmail.<domain>
#   workers      → PM2 "migration-orchestrator" / "-users" / "-messages"
#                  no listener; BullMQ consumers on the local Redis sidecar
#
# Everything talks to Stalwart over loopback JMAP (127.0.0.1:8080), to RDS over
# TLS, and to the redis6 sidecar on 127.0.0.1:6379.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ─── Where ───────────────────────────────────────────────────────────────────
AWS_EC2_IP="${AWS_EC2_IP:?Set AWS_EC2_IP from pulumi stack output mailIp}"
AWS_SSH_KEY="${AWS_SSH_KEY:-$HOME/.ssh/arham-aws-key.pem}"
AWS_SSH_KEY="${AWS_SSH_KEY/#\~/$HOME}"   # a quoted ~ is not expanded by the shell
REMOTE_USER="${REMOTE_USER:-ec2-user}"

# dbAddress is the BARE hostname. dbEndpoint is host:port and breaks every URL below.
AWS_PG_HOST="${AWS_PG_HOST:?Set AWS_PG_HOST from pulumi stack output dbAddress}"
AWS_PG_PASS="${AWS_PG_PASS:?Set AWS_PG_PASS — the dbPassword from pulumi config}"
AWS_PG_PORT="${AWS_PG_PORT:-5432}"
AWS_PG_USER="${AWS_PG_USER:-arhamapp}"
DOMAIN="${DOMAIN:-arhamworkspace.tech}"

# Local sidecar services on the mail EC2 — no ElastiCache, no separate JMAP host.
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
JMAP_PORT="${JMAP_PORT:-8080}"

# Must match the ports configure-stalwart.sh proxies to.
CONSOLE_PORT="${CONSOLE_PORT:-3002}"
WEBUI_PORT="${WEBUI_PORT:-3000}"

# Which apps to (re)deploy. "console webui workers" by default; narrow it when
# you are pushing a fix to one thing at 2am.
APPS="${APPS:-console webui workers}"

SSH="ssh -i ${AWS_SSH_KEY} -o StrictHostKeyChecking=accept-new ${REMOTE_USER}@${AWS_EC2_IP}"
SCP="scp -i ${AWS_SSH_KEY} -o StrictHostKeyChecking=accept-new"

# ─── Secrets ─────────────────────────────────────────────────────────────────
# Two files, both gitignored, both optional individually — between them they must
# supply every key the selected apps need:
#   console-app/.env.production.secrets  (already used by deploy-console.sh)
#   infra/.env.deploy.secrets            (the extra keys webui and the workers
#                                         need: SESSION_SECRET, STALWART_ADMIN_*)
# The second is sourced last, so it wins on any key both define.
CONSOLE_SECRETS="${CONSOLE_SECRETS:-$REPO_ROOT/console-app/.env.production.secrets}"
INFRA_SECRETS="${INFRA_SECRETS:-$REPO_ROOT/infra/.env.deploy.secrets}"

loaded_any=0
for f in "$CONSOLE_SECRETS" "$INFRA_SECRETS"; do
  if [ -f "$f" ]; then
    # shellcheck disable=SC1090
    set -a; source "$f"; set +a
    echo "Loaded secrets from $f"
    loaded_any=1
  fi
done
if [ "$loaded_any" -eq 0 ]; then
  echo "ERROR: no secrets file found. Expected at least one of:"
  echo "  $CONSOLE_SECRETS"
  echo "  $INFRA_SECRETS"
  echo ""
  echo "Start from console-app/.env.production.example, and add for webui/workers:"
  echo "  SESSION_SECRET=\$(openssl rand -base64 32)"
  echo "  STALWART_ADMIN_USER=admin"
  echo "  STALWART_ADMIN_PASS=..."
  exit 1
fi

require_vars() {
  local missing=()
  for v in "$@"; do
    # NB: `[ ... ] && missing+=(...)` would make this function return 1 on the
    # last iteration when nothing is missing, which `set -e` reads as failure.
    if [ -z "${!v:-}" ]; then missing+=("$v"); fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: missing required values: ${missing[*]}"
    echo "       Add them to $CONSOLE_SECRETS or $INFRA_SECRETS and re-run."
    exit 1
  fi
}

case " $APPS " in *" console "*)
  require_vars JMAP_ADMIN_AUTH JWT_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET \
               RAZORPAY_WEBHOOK_SECRET MIGRATION_ENCRYPTION_KEY ;;
esac
case " $APPS " in *" webui "*)
  require_vars SESSION_SECRET MIGRATION_ENCRYPTION_KEY ;;
esac
case " $APPS " in *" workers "*)
  require_vars MIGRATION_ENCRYPTION_KEY SESSION_SECRET STALWART_ADMIN_USER STALWART_ADMIN_PASS ;;
esac

# ─── Sanity ──────────────────────────────────────────────────────────────────
if [[ "$AWS_PG_HOST" == *:* ]]; then
  echo "ERROR: AWS_PG_HOST is '${AWS_PG_HOST}' — that is dbEndpoint (host:port)."
  echo "       Use: pulumi stack output dbAddress"
  exit 1
fi

# Both Next apps receive the DB as a URL, so a password needing percent-encoding
# silently produces a broken connection string. Same check migrate-from-do.sh makes.
case "$AWS_PG_PASS" in
  *[!A-Za-z0-9._~-]*)
    echo "ERROR: AWS_PG_PASS has characters that must be percent-encoded in a URL."
    echo "       Regenerate it URL-safe:"
    echo "         pulumi config set --secret dbPassword \"\$(openssl rand -hex 24)\""
    exit 1 ;;
esac

# console-app pins its port in package.json ("next start -p 3002"), so a
# CONSOLE_PORT that disagrees would leave nginx proxying to a dead port.
if ! grep -q -- "-p ${CONSOLE_PORT}" "$REPO_ROOT/console-app/package.json"; then
  echo "WARNING: console-app/package.json does not pin port ${CONSOLE_PORT}."
  echo "         nginx (configure-stalwart.sh) proxies console./inbox. to ${CONSOLE_PORT}."
  echo "         Check the 'start' script before you trust a green deploy."
fi

echo "================================================"
echo "  Deploying apps → ${AWS_EC2_IP}"
echo "================================================"
echo "  apps    : ${APPS}"
echo "  domain  : ${DOMAIN}"
echo "  RDS     : ${AWS_PG_USER}@${AWS_PG_HOST}:${AWS_PG_PORT}"
echo "  redis   : ${REDIS_HOST}:${REDIS_PORT} (sidecar)"
echo "  JMAP    : 127.0.0.1:${JMAP_PORT} (loopback)"
echo ""

echo "Checking the instance is ready..."
$SSH "command -v node >/dev/null && command -v pm2 >/dev/null" || {
  echo "ERROR: node and/or pm2 are missing on ${AWS_EC2_IP}."
  echo "       user_data has not finished — tail /var/log/arham-setup.log and wait"
  echo "       for 'Bootstrap complete'."
  exit 1
}
$SSH "sudo mkdir -p /var/log/arham && sudo chown ${REMOTE_USER}:${REMOTE_USER} /var/log/arham"

# Env files are built here and scp'd, never interpolated into a remote shell —
# a password containing \$ or a backtick would otherwise be executed on the box.
STAGE="$(mktemp -d)"
chmod 700 "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

PG_BASE="postgresql://${AWS_PG_USER}:${AWS_PG_PASS}@${AWS_PG_HOST}:${AWS_PG_PORT}"
REDIS_URL_LOCAL="redis://${REDIS_HOST}:${REDIS_PORT}"

# pack <dir> <tarball>  — source tree only; deps and build output are produced
# on the box, and no .env from a developer's laptop ever travels.
pack() {
  local dir="$1" out="$2"
  tar --exclude="${dir}/node_modules" \
      --exclude="${dir}/.next" \
      --exclude="${dir}/.git" \
      --exclude="${dir}/e2e" \
      --exclude="${dir}/.env" \
      --exclude="${dir}/.env.*" \
      -czf "$out" -C "$REPO_ROOT" "$dir"
}

# ─── console-app ─────────────────────────────────────────────────────────────
if [[ " $APPS " == *" console "* ]]; then
  echo ""
  echo "=== console-app → arham-console (127.0.0.1:${CONSOLE_PORT}) ==="

  cat > "$STAGE/console.env" << ENVEOF
DATABASE_URL=${PG_BASE}/arham-console?sslmode=require
# Stalwart's HTTP listener is loopback-only on this box; nginx fronts it on 443.
JMAP_URL=http://127.0.0.1:${JMAP_PORT}
JMAP_ADMIN_AUTH=${JMAP_ADMIN_AUTH}
JWT_SECRET=${JWT_SECRET}
RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID}
RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET}
RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET}
MIGRATION_PG_URL=${PG_BASE}/arham-migration?sslmode=require
# Local redis6 sidecar on this instance — not ElastiCache.
REDIS_URL=${REDIS_URL_LOCAL}
MIGRATION_ENCRYPTION_KEY=${MIGRATION_ENCRYPTION_KEY}
NODE_ENV=production
ENVEOF

  pack console-app "$STAGE/console-app.tar.gz"
  $SCP "$STAGE/console-app.tar.gz" "$STAGE/console.env" "${REMOTE_USER}@${AWS_EC2_IP}:/tmp/"
  $SSH "APP_DIR=/home/${REMOTE_USER}/arham-console PORT=${CONSOLE_PORT} bash -s" << 'REMOTE'
set -euo pipefail
mkdir -p "$APP_DIR"
cd "$APP_DIR"
tar -xzf /tmp/console-app.tar.gz --strip-components=1
install -m 600 /tmp/console.env "$APP_DIR/.env.local"
rm -f /tmp/console-app.tar.gz /tmp/console.env

npm install --production=false
npm run build

# PORT is exported so PM2 hands it to the child. console-app also pins -p in its
# own start script; both agree, and --update-env makes a restart pick up changes.
export PORT
if pm2 describe arham-console >/dev/null 2>&1; then
  pm2 restart arham-console --update-env
else
  pm2 start npm --name arham-console -- start
fi
REMOTE
  echo "console-app deployed"
fi

# ─── webui ───────────────────────────────────────────────────────────────────
if [[ " $APPS " == *" webui "* ]]; then
  echo ""
  echo "=== webui → arham-webui (127.0.0.1:${WEBUI_PORT}) ==="

  # NEXT_PUBLIC_* is baked in at build time, so the browser-facing JMAP URL must
  # be the PUBLIC one (nginx on mail.<domain>), while server-side calls stay on
  # loopback. Getting these two the same way round is the usual webmail bug.
  cat > "$STAGE/webui.env" << ENVEOF
APP_NAME=Arham Workspace Mail
NEXT_PUBLIC_APP_NAME=Arham Workspace Mail
APP_SHORT_NAME=Arham Mail
LOGIN_COMPANY_NAME=Arham Workspace
LOGIN_WEBSITE_URL=https://${DOMAIN}

# Server-side JMAP: loopback. Browser-side: through nginx on mail.<domain>.
JMAP_SERVER_URL=http://127.0.0.1:${JMAP_PORT}
NEXT_PUBLIC_JMAP_SERVER_URL=https://mail.${DOMAIN}
STALWART_URL=http://127.0.0.1:${JMAP_PORT}
STALWART_FEATURES=true

SESSION_SECRET=${SESSION_SECRET}
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax

# Migration pipeline — same RDS + sidecar Redis as the console.
MIGRATION_PG_URL=${PG_BASE}/arham-migration?sslmode=require
REDIS_URL=${REDIS_URL_LOCAL}
MIGRATION_ENCRYPTION_KEY=${MIGRATION_ENCRYPTION_KEY}
${GROQ_API_KEY:+GROQ_API_KEY=${GROQ_API_KEY}}

# Upstream telemetry off — this is a customer mail host.
BULWARK_TELEMETRY=off

HOSTNAME=127.0.0.1
PORT=${WEBUI_PORT}
NODE_ENV=production
ENVEOF

  pack webui "$STAGE/webui.tar.gz"
  $SCP "$STAGE/webui.tar.gz" "$STAGE/webui.env" "${REMOTE_USER}@${AWS_EC2_IP}:/tmp/"
  $SSH "APP_DIR=/home/${REMOTE_USER}/arham-webui PORT=${WEBUI_PORT} bash -s" << 'REMOTE'
set -euo pipefail
mkdir -p "$APP_DIR"
cd "$APP_DIR"
tar -xzf /tmp/webui.tar.gz --strip-components=1
install -m 600 /tmp/webui.env "$APP_DIR/.env.local"
rm -f /tmp/webui.tar.gz /tmp/webui.env

npm install --production=false
# 4 GB box with swap; cap the build heap so an OOM kill hits node and not stalwart.
NODE_OPTIONS="--max-old-space-size=2048" npm run build

# `next start` reads PORT/HOSTNAME from the real process environment, NOT from
# .env.local — pm2 has to be given them, or it silently listens on 3000/0.0.0.0.
export PORT HOSTNAME=127.0.0.1
if pm2 describe arham-webui >/dev/null 2>&1; then
  pm2 restart arham-webui --update-env
else
  pm2 start npm --name arham-webui -- start
fi
REMOTE
  echo "webui deployed"
fi

# ─── migration workers ───────────────────────────────────────────────────────
if [[ " $APPS " == *" workers "* ]]; then
  echo ""
  echo "=== workers → migration-orchestrator / -users / -messages ==="

  cat > "$STAGE/workers.env" << ENVEOF
# Workers read this with dotenv from their cwd.
MIGRATION_PG_URL=${PG_BASE}/arham-migration?sslmode=require
REDIS_URL=${REDIS_URL_LOCAL}

# Stalwart on this same box, over loopback JMAP.
STALWART_URL=http://127.0.0.1:${JMAP_PORT}
STALWART_ADMIN_USER=${STALWART_ADMIN_USER}
STALWART_ADMIN_PASS=${STALWART_ADMIN_PASS}

# Must match the console and webui values or in-flight jobs cannot be decrypted.
MIGRATION_ENCRYPTION_KEY=${MIGRATION_ENCRYPTION_KEY}
SESSION_SECRET=${SESSION_SECRET}

NODE_ENV=production
ENVEOF

  pack workers "$STAGE/workers.tar.gz"
  $SCP "$STAGE/workers.tar.gz" "$STAGE/workers.env" "${REMOTE_USER}@${AWS_EC2_IP}:/tmp/"
  $SSH "APP_DIR=/home/${REMOTE_USER}/arham-workers bash -s" << 'REMOTE'
set -euo pipefail
mkdir -p "$APP_DIR"
cd "$APP_DIR"
tar -xzf /tmp/workers.tar.gz --strip-components=1
install -m 600 /tmp/workers.env "$APP_DIR/.env"
rm -f /tmp/workers.tar.gz /tmp/workers.env

# tsx is a devDependency and is the interpreter, so this cannot be --production.
npm install --production=false

# The repo's ecosystem.config.cjs is the DigitalOcean layout (/home/ubuntu, and
# 2+2 worker instances). Generate the AWS one instead: ec2-user paths, and one
# instance per queue — this t4g.medium is also running Stalwart, nginx and two
# Next.js servers in 4 GB. Scale the instances up here if imports fall behind
# and the box has headroom.
cat > "$APP_DIR/ecosystem.aws.cjs" << ECO
module.exports = {
  apps: [
    { name: 'migration-orchestrator', instances: 1, env: { QUEUE_TYPE: 'orchestrator', WORKER_CONCURRENCY: '2' },  max_memory_restart: '256M' },
    { name: 'migration-users',        instances: 1, env: { QUEUE_TYPE: 'users',        WORKER_CONCURRENCY: '4' },  max_memory_restart: '400M' },
    { name: 'migration-messages',     instances: 1, env: { QUEUE_TYPE: 'messages',     WORKER_CONCURRENCY: '10' }, max_memory_restart: '400M' },
  ].map(a => ({
    ...a,
    cwd: '$APP_DIR',
    script: 'index.ts',
    interpreter: '$APP_DIR/node_modules/.bin/tsx',
    exec_mode: 'fork',
    env_file: '$APP_DIR/.env',
    restart_delay: 5000,
    log_file: '/var/log/arham/' + a.name + '.log',
    time: true,
  })),
};
ECO

# startOrRestart, not start: a plain `pm2 start` on an already-running ecosystem
# reports "already launched" and quietly leaves the OLD code running.
pm2 startOrRestart "$APP_DIR/ecosystem.aws.cjs" --update-env
REMOTE
  echo "workers deployed"
fi

# ─── Persist + verify ────────────────────────────────────────────────────────
echo ""
echo "=== Saving PM2 process list (survives reboot via the systemd unit) ==="
$SSH "pm2 save"

echo ""
echo "=== Verifying ==="
failed=0
check() {   # check <label> <remote command>
  if $SSH "$2" >/dev/null 2>&1; then
    echo "  $1: OK"
  else
    echo "  $1: FAILED"
    failed=1
  fi
}
check "stalwart JMAP  127.0.0.1:${JMAP_PORT}" "curl -sf http://127.0.0.1:${JMAP_PORT}/jmap/session -o /dev/null"
if [[ " $APPS " == *" console "* ]]; then
  check "console       127.0.0.1:${CONSOLE_PORT}" "curl -sf -o /dev/null http://127.0.0.1:${CONSOLE_PORT}/"
fi
if [[ " $APPS " == *" webui "* ]]; then
  check "webui         127.0.0.1:${WEBUI_PORT}" "curl -sf -o /dev/null http://127.0.0.1:${WEBUI_PORT}/"
fi
if [[ " $APPS " == *" workers "* ]]; then
  check "workers online" "pm2 jlist | grep -q '\"status\":\"online\"' && ! pm2 jlist | grep -q '\"status\":\"errored\"'"
fi

echo ""
$SSH "pm2 status" || true

echo ""
if [ "$failed" -ne 0 ]; then
  echo "================================================"
  echo "  DEPLOY INCOMPLETE — something above is down"
  echo "================================================"
  echo "  pm2 logs --lines 100          (app stdout/stderr)"
  echo "  pm2 status                    (which process is not online)"
  echo "  journalctl -u stalwart-mail   (if JMAP is the failure)"
  exit 1
fi

echo "================================================"
echo "  Apps deployed and answering on loopback"
echo "================================================"
echo "Public URLs (after DNS cutover + certbot):"
echo "  https://console.${DOMAIN}   → console-app"
echo "  https://inbox.${DOMAIN}     → console-app"
echo "  https://webmail.${DOMAIN}   → webui"
echo "  https://mail.${DOMAIN}      → Stalwart JMAP"
echo ""
echo "Before cutover you can test them through nginx from the box itself:"
echo "  curl -ksi --resolve console.${DOMAIN}:443:${AWS_EC2_IP} https://console.${DOMAIN}/ | head -1"
