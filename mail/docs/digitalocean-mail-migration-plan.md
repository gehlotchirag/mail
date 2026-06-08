# Migration & Deliverability Plan — DigitalOcean for arhamworkspace.tech

Purpose: Move the Flux mail service to a DigitalOcean droplet, host the landing site at `arhamworkspace.tech`, and run mail on `mail.arhamworkspace.tech` / `inbox.arhamworkspace.tech` with strong deliverability (SPF, DKIM, DMARC, TLS, PTR).

Summary timeline (recommended order)
- Reserve DO Reserved IP (optional but recommended)
- Provision droplet in `blr1` and set hostname
- Configure DNS for landing site and mail subdomains
- Bootstrap server (packages, firewall, users)
- Install PostgreSQL and restore data
- Install and configure Flux, enable DKIM signing
- Obtain TLS certs and configure SMTP + web TLS
- Test deliverability and check blocklists
- Swap DNS MX/A records and monitor

Prerequisites
- Domain: `arhamworkspace.tech` (DNS control via GoDaddy or chosen registrar)
- Flux artifacts (binary, webui, blobs) accessible from old server
- Admin SSH key for DO account
- Contact email for DMARC reports (postmaster@arhamworkspace.tech)

DNS design (recommended)
- A @ -> <WEB_IP>         # landing site (arhamworkspace.tech)
- A mail -> <MAIL_IP>     # mail.arhamworkspace.tech (SMTP, HELO name)
- A mail-reserved -> <RESERVED_IP> (if using reserved)
- CNAME www -> arhamworkspace.tech
- CNAME inbox -> mail.arhamworkspace.tech (or A to same IP)
- MX @ -> mail.arhamworkspace.tech (priority 10)

Initial TXT records (replace <IP> and <PUBLIC_DKIM_KEY>)
- SPF (apex):
  - Name: `@`
  - Value: `v=spf1 mx ip4:<MAIL_IP> -all`
- DKIM (selector `default`):
  - Name: `default._domainkey`
  - Value: `v=DKIM1; k=rsa; p=<PUBLIC_DKIM_KEY>`
- DMARC:
  - Name: `_dmarc`
  - Value (start): `v=DMARC1; p=none; rua=mailto:postmaster@arhamworkspace.tech; pct=100`

Notes: start DMARC with `p=none` to gather reports; move to `p=quarantine` or `p=reject` after confidence.

Server provisioning (DO)
1. Create Droplet (Ubuntu 22.04) in `blr1` (size: s-2vcpu-4gb or larger).
2. Allocate Reserved IP and attach to droplet (recommended for IP stability).
3. Ensure DO account has SSH key uploaded.
4. Set droplet hostname to `mail.arhamworkspace.tech` (see next section).

Bootstrap commands (run as root / first admin user)
```bash
apt update && apt upgrade -y
apt install -y postgresql nginx certbot python3-certbot-nginx ufw git curl swaks opendkim opendkim-tools

# Firewall
ufw allow OpenSSH
ufw allow 25/tcp
ufw allow 465/tcp
ufw allow 587/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 993/tcp
ufw allow 995/tcp
ufw enable
```

Hostname & PTR
- Set hostname on the droplet:
```bash
hostnamectl set-hostname mail.arhamworkspace.tech
```
- Verify DO PTR matches hostname after droplet hostname is set. If using Reserved IP, set the reverse DNS for the Reserved IP in DO control panel to `mail.arhamworkspace.tech`.

PostgreSQL
- Create user and DB (choose secure password):
```bash
sudo -u postgres psql -c "CREATE USER flux_mail WITH PASSWORD '<<STRONG_PW>>';"
sudo -u postgres psql -c "CREATE DATABASE flux_mail OWNER flux_mail;"
```
- Restore dump as described in migration steps.

Transfer files & Flux
- Transfer binary, webui, and blobs via `scp` or `rsync`.
- Ensure ownership and permissions:
```bash
mkdir -p /home/ubuntu/flux /var/lib/flux
chown -R ubuntu:ubuntu /home/ubuntu/flux /var/lib/flux
```
- Create systemd unit at `/etc/systemd/system/flux.service` with `User=ubuntu` and `ExecStart=/home/ubuntu/flux/flux --config /home/ubuntu/flux/config.json`.

DKIM (using OpenDKIM or Flux built-in signing)
Option A: Use OpenDKIM (standalone milter) — works with Postfix; Flux may sign itself, prefer Flux-integrated signing if available.
Steps (OpenDKIM example):
```bash
# generate keys
mkdir -p /etc/opendkim/keys/arhamworkspace.tech
cd /etc/opendkim/keys/arhamworkspace.tech
opendkim-genkey -s default -d arhamworkspace.tech
chown -R opendkim:opendkim /etc/opendkim/keys
# public key in default.txt -> add to DNS as default._domainkey.arhamworkspace.tech
```
If Flux supports DKIM signing directly, generate keys and supply private key path to Flux config; publish public key to DNS.

SPF
- Use `v=spf1 mx ip4:<MAIL_IP> -all` or include any relay IPs if still using Brevo or others.

SMTP TLS
- Use certbot to get certs for `mail.arhamworkspace.tech` and `inbox.arhamworkspace.tech`.
- Configure Flux SMTP listener to use the Let's Encrypt certs for STARTTLS/SMTPS.

Nginx for web UI
- Configure virtual host for `inbox.arhamworkspace.tech` -> proxy to `127.0.0.1:18080` with TLS.
- Use certbot `--nginx` to obtain/auto-configure cert.

Remove Brevo relay (only after tests pass)
- Update Flux JMAP/Outbound strategy to `mx`.
- Remove Brevo route.

Verification & tests
- DNS checks:
```bash
dig +short A mail.arhamworkspace.tech
dig +short MX arhamworkspace.tech
dig +short TXT arhamworkspace.tech
dig +short TXT default._domainkey.arhamworkspace.tech
dig +short TXT _dmarc.arhamworkspace.tech
```
- PTR check:
```bash
dig +short -x <MAIL_IP>
```
- SMTP/TLS test with `swaks` (install `swaks`):
```bash
swaks --to you@example.com --server mail.arhamworkspace.tech --helo mail.arhamworkspace.tech --tls
```
- DKIM test: send to Gmail and inspect message headers for `DKIM-Signature` and `Authentication-Results`.

Blocklist checks
- Before switching MX, check the new IP against common RBLs (Spamhaus, SURBL):
  - Use `mxtoolbox.com` or `multirbl.valli.org`.

Monitoring after cutover
- Monitor logs: `/var/log/flux`, `/var/log/mail.log`
- Watch DMARC aggregate reports (RUA) to the configured address.
- Monitor bounce and spam complaints; adjust DKIM/SPF/contents as needed.

Rollback plan
- Keep Brevo relay active and able to be re-enabled quickly.
- Do not change MX TTLs to high values before cutover — use low TTL (e.g., 300s) for quick rollback.

Cutover checklist (short)
- [ ] DNS A record for `mail` -> new IP (low TTL) applied
- [ ] MX point to `mail.arhamworkspace.tech`
- [ ] PTR resolves to `mail.arhamworkspace.tech`
- [ ] SPF TXT present and validated
- [ ] DKIM public key published and signatures present
- [ ] DMARC present (p=none initially)
- [ ] TLS certs issued and SMTP TLS works
- [ ] Deliverability tested with `swaks` and Gmail header checks
- [ ] Brevo relay disabled and system set to `mx` routing

Useful commands summary
```bash
# Hostname
hostnamectl set-hostname mail.arhamworkspace.tech

# Generate DKIM key (opendkim example)
opendkim-genkey -s default -d arhamworkspace.tech
# Show public key
cat default.txt

# PTR check
dig +short -x <MAIL_IP>

# SPF/DKIM/DMARC DNS check
dig +short TXT arhamworkspace.tech
dig +short TXT default._domainkey.arhamworkspace.tech
dig +short TXT _dmarc.arhamworkspace.tech

# SMTP TLS test
swaks --to you@example.com --server mail.arhamworkspace.tech --helo mail.arhamworkspace.tech --tls
```

Notes & tips
- Prefer a Reserved IP to avoid reconfiguring DNS on droplet replacement.
- DO may restrict outbound port 25 — request removal early.
- Use low DNS TTLs (300) during migration window.
- Keep DMARC in `p=none` until DKIM/SPF stable and complaints monitored.

Contact points
- Postmaster and admin: postmaster@arhamworkspace.tech, admin@arhamworkspace.tech

-- End of plan
