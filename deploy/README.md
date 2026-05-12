# Flux Mail Server — Deployment

On-prem Flux mail server setup. Stores configuration in PostgreSQL. Admin panel served at `/admin/`.

## Quick Start

### 1. Build the binary (with PostgreSQL support)
```bash
cargo build --bin flux --features postgres,enterprise
```

### 2. Set up PostgreSQL
```bash
FLUX_DB_PASSWORD=your_password sudo -u postgres bash deploy/scripts/setup_postgres.sh
```

### 3. Build patched webui
```bash
python3 deploy/scripts/build_webui.py /path/to/webui-flux.zip
```

### 4. Copy config template
```bash
cp deploy/config.example.json config.json
# Edit config.json — replace YOUR_DB_PASSWORD_HERE
```

### 5. First-time bootstrap (run once, server must be in bootstrap mode)
```bash
export FLUX_RECOVERY_PASS=<value of STALWART_RECOVERY_ADMIN after the colon>
export FLUX_DB_PASS=your_db_password
export FLUX_DOMAIN=arhamfintech.ai
export FLUX_HOSTNAME=mail.arhamfintech.ai
python3 deploy/scripts/bootstrap_setup.py
```

### 6. Install systemd service
```bash
sudo cp deploy/flux.service /etc/systemd/system/flux.service
sudo systemctl daemon-reload
sudo systemctl enable --now flux.service
```

### 7. Install nginx config
```bash
sudo cp deploy/nginx/email.arhamshare.com.conf /etc/nginx/sites-enabled/email.arhamshare.com
sudo nginx -t && sudo systemctl reload nginx
```

## Important Notes

- **Do NOT** add `sub_filter "stalwart" "flux"` in nginx for JS or JSON content types — it breaks the JMAP capability URI `urn:stalwart:jmap` causing 400 errors in the admin panel.
- `config.json` is excluded from git (contains DB credentials). Use `config.example.json` as template.
- `webui-flux.zip` is excluded from git (binary). Regenerate with `deploy/scripts/build_webui.py`.
- The service requires `AmbientCapabilities=CAP_NET_BIND_SERVICE` to bind ports 25, 465, 587, 993, 995.
- Debug builds need `RUST_MIN_STACK=33554432` to avoid stack overflow during crypto operations.

## After Setup

1. Log in at `http://email.arhamshare.com/admin/` with credentials from bootstrap output
2. Go to **Management → Domains** → enable automatic DKIM management
3. Add DNS records shown in the domain's zone file
4. Set up TLS certificate via **Management → Domains → Certificate Management**
5. Create user accounts via **Management → Accounts**
