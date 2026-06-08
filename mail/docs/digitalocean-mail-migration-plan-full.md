# Full Migration & Deliverability Plan — DigitalOcean for arhamworkspace.tech

This document is a comprehensive, step-by-step migration and deliverability plan to host the landing site `arhamworkspace.tech` and run mail from `mail.arhamworkspace.tech` / `inbox.arhamworkspace.tech` using the Flux mail server.

Goal
- Move mail off an ISP-blacklisted IP to a stable DO Droplet/Reserved IP
- Configure SPF, DKIM, DMARC, TLS, and proper HELO/PTR to maximize inbox placement
- Provide commands, config snippets, tests, monitoring, and rollback steps

Paths in repository
- Plan file: [mail/docs/digitalocean-mail-migration-plan-full.md](mail/docs/digitalocean-mail-migration-plan-full.md)
- Example systemd unit: `/etc/systemd/system/flux.service`
- Example Flux config: `/home/ubuntu/flux/config.json`

1) Preliminary decisions
- Domain: `arhamworkspace.tech` (apex landing site)
- Mail hostname (HELO/PTR): `mail.arhamworkspace.tech`
- Webmail/UI hostname: `inbox.arhamworkspace.tech`
- Use a DO Reserved IP for mail (recommended)
- DNS registrar: GoDaddy (you indicated before) — but steps apply to any DNS provider

2) DNS plan (pre-cutover)
- Set short TTLs for A/MX/TXT changes (e.g., 300s) at least 1 hour before cutover.
- Prepare the following records (replace `<MAIL_IP>` and `<PUBLIC_DKIM_KEY>`):
  - A @ -> <WEB_IP>             # landing page
  - A mail -> <MAIL_IP>         # mail.arhamworkspace.tech
  - CNAME www -> arhamworkspace.tech
  - CNAME inbox -> mail.arhamworkspace.tech
  - MX @ -> mail.arhamworkspace.tech (priority 10)
  - TXT @ (SPF) -> `v=spf1 mx ip4:<MAIL_IP> -all`
  - TXT default._domainkey -> `v=DKIM1; k=rsa; p=<PUBLIC_DKIM_KEY>`
  - TXT _dmarc -> `v=DMARC1; p=none; rua=mailto:postmaster@arhamworkspace.tech; pct=100`

3) DigitalOcean provisioning
- Reserve a Reserved IP (optional but recommended) and attach to droplet.
- Create droplet in `blr1`, Ubuntu 22.04, recommended size `s-2vcpu-4gb` or larger.
- Add your SSH key to the DO droplet creation process.
- After droplet is active, set hostname to `mail.arhamworkspace.tech` and verify reverse DNS in DO console points to the hostname.

Commands (local laptop or admin shell)
```bash
# Create droplet via DO web console or doctl
# After SSHing into droplet as root (or ubuntu), set hostname:
sudo hostnamectl set-hostname mail.arhamworkspace.tech
# Ensure /etc/hosts contains:
# 127.0.0.1 localhost
# <MAIL_IP> mail.arhamworkspace.tech mail
```

4) Server bootstrap
- Install packages, firewall and helpers:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y postgresql nginx certbot python3-certbot-nginx ufw git curl swaks opendkim opendkim-tools rsync

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 25/tcp
sudo ufw allow 465/tcp
sudo ufw allow 587/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 993/tcp
sudo ufw allow 995/tcp
sudo ufw enable
```
- Create admin user (mirror old server `ubuntu`):
```bash
sudo adduser --disabled-password --gecos "" ubuntu
sudo usermod -aG sudo ubuntu
# Add your public key to /home/ubuntu/.ssh/authorized_keys
```

5) PostgreSQL setup & data migration
- On new server:
```bash
sudo -u postgres psql -c "CREATE USER flux_mail WITH PASSWORD '<<STRONG_PW>>';"
sudo -u postgres psql -c "CREATE DATABASE flux_mail OWNER flux_mail;"
```
- On old server (dump):
```bash
PGPASSWORD='<<OLD_PW>>' pg_dump -h 127.0.0.1 -U flux_mail -d flux_mail -F c -f /tmp/flux_mail.dump
scp /tmp/flux_mail.dump ubuntu@<MAIL_IP>:/tmp/
```
- Restore on new server:
```bash
PGPASSWORD='<<STRONG_PW>>' pg_restore -h 127.0.0.1 -U flux_mail -d flux_mail /tmp/flux_mail.dump
```

6) Transfer Flux artifacts
- Use `rsync`/`scp` to transfer `/home/ubuntu/flux/`, binary, `webui` and `/var/lib/flux/` blobs.
```bash
rsync -avz -e "ssh -i ~/.ssh/id_rsa" ubuntu@old:/home/ubuntu/flux/ /home/ubuntu/flux/
rsync -avz -e "ssh -i ~/.ssh/id_rsa" ubuntu@old:/var/lib/flux/ /var/lib/flux/
sudo chown -R ubuntu:ubuntu /home/ubuntu/flux /var/lib/flux
```

7) `flux.service` systemd unit
- Create `/etc/systemd/system/flux.service` with the following content:
```ini
[Unit]
Description=Flux Mail Server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/flux
Environment=RUST_MIN_STACK=33554432
ExecStart=/home/ubuntu/flux/flux --config /home/ubuntu/flux/config.json
Restart=on-failure
RestartSec=5
User=ubuntu
Group=ubuntu
LimitNOFILE=65536
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```
- Reload and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now flux
sudo journalctl -u flux -f
```

8) Flux configuration (`/home/ubuntu/flux/config.json`)
- Minimal DB config (replace password):
```json
{"@type":"PostgreSql","timeout":15000,"useTls":false,"allowInvalidCerts":false,
"poolMaxConnections":10,"poolRecyclingMethod":"fast","readReplicas":{},
"host":"127.0.0.1","port":5432,"database":"flux_mail","authUsername":"flux_mail",
"authSecret":{"@type":"Value","secret":"<<STRONG_PW>>"},"options":null}
```
- Add or configure Flux to use the canonical hostname `mail.arhamworkspace.tech` for EHLO/HELO. If Flux has a `hostname` setting in its config, set that to the mail hostname.

9) DKIM: generate keys and publish
Option A — Flux built-in DKIM signing (preferred if Flux supports it):
- Generate RSA keypair on server:
```bash
mkdir -p /home/ubuntu/flux/dkim && cd /home/ubuntu/flux/dkim
ssh-keygen -t rsa -b 2048 -m PEM -f default -N ""
# private: default
# public: default.pub (open & format for DNS p=... value)
```
- Format public key for DNS: remove header/footer and newlines, produce `p=` value.
- Add DNS TXT record at `default._domainkey.arhamworkspace.tech` with `v=DKIM1; k=rsa; p=<PUBLIC>`
- Configure Flux to sign mails with the private key (path `/home/ubuntu/flux/dkim/default`).

Option B — OpenDKIM (milter) if you need a separate signing service
- Generate keys with `opendkim-genkey -s default -d arhamworkspace.tech` and publish public key.

10) SPF record
- Add TXT record at apex:
```
v=spf1 mx ip4:<MAIL_IP> -all
```
- If you keep Brevo or other relays, include `include:brevo.net` or their provided include.

11) DMARC
- Start with `p=none` to collect reports:
```
v=DMARC1; p=none; rua=mailto:postmaster@arhamworkspace.tech; ruf=mailto:postmaster@arhamworkspace.tech; pct=100
```
- After monitoring, move to `p=quarantine` then `p=reject` as appropriate.

12) Obtain TLS certs for web & SMTP
- Use certbot to issue certificates for `mail.arhamworkspace.tech` and `inbox.arhamworkspace.tech`.
```bash
sudo certbot certonly --nginx -d mail.arhamworkspace.tech -d inbox.arhamworkspace.tech --non-interactive --agree-tos -m admin@arhamworkspace.tech
```
- Configure Flux SMTP listeners to use `/etc/letsencrypt/live/mail.arhamworkspace.tech/fullchain.pem` and `privkey.pem` for STARTTLS/SMTPS.

13) Nginx web UI
- Create Nginx site for `inbox.arhamworkspace.tech` proxying to `127.0.0.1:18080` and enable SSL using certbot `--nginx` or manual config.

14) Verify DO outbound SMTP policy
- Confirm DO allows outbound port 25 for your account/droplet. If restricted, file a support request to remove the rate-limit or restriction.

15) Pre-cutover tests (before changing MX/A records globally)
- DNS checks (after publishing TXT records):
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
- SMTP/TLS test with `swaks`:
```bash
swaks --to you@gmail.com --from postmaster@arhamworkspace.tech --server mail.arhamworkspace.tech --helo mail.arhamworkspace.tech --tls
```
- Send test messages to Gmail and other providers; inspect `Authentication-Results` and `DKIM-Signature` headers.

16) Blocklist checks
- Check the new IP with Spamhaus, MXToolbox, Multirbl.
- If listed, follow their delisting procedures (remove the cause first).

17) Cutover steps
- Lower DNS TTLs to 300s well in advance.
- Publish A record for `mail` -> new IP and MX apex -> `mail.arhamworkspace.tech`.
- Wait for propagation and monitor logs.
- Keep Brevo relay configured but disabled; be ready to re-enable if issues arise.

18) Post-cutover monitoring
- Monitor `journalctl -u flux -f` and `/var/log/mail.log` for errors.
- Watch DMARC reports and bounces at `postmaster@arhamworkspace.tech`.
- Monitor delivery rates, rejections and spam complaints.

19) Rollback plan
- Keep MX TTL low at cutover; if deliverability is poor, revert MX to previous relay (Brevo) and re-enable relay settings in Flux.
- Keep backup of DB and filesystem for quick re-instantiation.

20) Additional hardening & best practices
- Set up monitoring and alerting (Grafana/Prometheus, or simple logwatch + email alerts).
- Track sending volume and patterns; ramp up slowly if you will send large volumes.
- Protect private keys and secrets (use proper filesystem permissions and avoid embedding secrets in logs).
- Implement rate-limits and abuse detection to avoid being abused for spam.

21) Helpful commands recap
```bash
# Systemd manage
sudo systemctl daemon-reload
sudo systemctl enable --now flux
sudo systemctl status flux
sudo journalctl -u flux -f

# DKIM key generation (Flux built-in example)
mkdir -p /home/ubuntu/flux/dkim && cd /home/ubuntu/flux/dkim
ssh-keygen -t rsa -b 2048 -m PEM -f default -N ""
# Extract public key
sed -n '1!p' default.pub | tr -d '\n' | sed 's/ssh-rsa //' > default-dns.txt

# DNS check
dig +short A mail.arhamworkspace.tech

# SMTP TLS test
swaks --to you@example.com --server mail.arhamworkspace.tech --helo mail.arhamworkspace.tech --tls
```

22) Ownership and file locations to note
- `flux.service` -> `/etc/systemd/system/flux.service`
- Flux config -> `/home/ubuntu/flux/config.json`
- Flux binary -> `/home/ubuntu/flux/flux`
- DKIM private key -> `/home/ubuntu/flux/dkim/default`
- Let's Encrypt certs -> `/etc/letsencrypt/live/mail.arhamworkspace.tech/`

23) Timeline estimate (approx)
- Prep & provisioning: 1–2 hours
- Data migration + config: 1–2 hours
- DKIM/SPF/DMARC + DNS propagation: 1–4 hours (propagation variable)
- Testing & cutover: 1–3 hours
- Monitoring & tuning: ongoing (first 48–72 hours critical)

24) Contacts & support
- Registrar/DNS admin (GoDaddy): account access required for DNS edits
- DigitalOcean support: for Reserved IP and port-25 policy
- Brevo (if keeping relay): account credentials and relay configs

25) Revision history
- Created: 2026-06-08
- Author: migration plan generator (team)

-- End of detailed plan
