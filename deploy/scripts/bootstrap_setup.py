#!/usr/bin/env python3
"""
Complete Flux mail server initial setup via the JMAP bootstrap API.
Run this ONCE against a server in bootstrap mode (no config.json).

Usage:
    python3 bootstrap_setup.py [--host HOST] [--port PORT]

Environment variables:
    FLUX_RECOVERY_USER   (default: Admin)
    FLUX_RECOVERY_PASS   (default: from STALWART_RECOVERY_ADMIN env on server)
    FLUX_DOMAIN          Mail domain, e.g. arhamfintech.ai
    FLUX_HOSTNAME        Server FQDN, e.g. mail.arhamfintech.ai
    FLUX_DB_HOST         PostgreSQL host (default: 127.0.0.1)
    FLUX_DB_PORT         PostgreSQL port (default: 5432)
    FLUX_DB_NAME         Database name (default: flux_mail)
    FLUX_DB_USER         Database user (default: flux_mail)
    FLUX_DB_PASS         Database password (REQUIRED)
    FLUX_BLOB_DIR        Blob storage path (default: /var/lib/flux/blobs)
    FLUX_LOG_DIR         Log directory (default: /var/log/flux)
"""
import json, urllib.request, base64, sys, os, argparse

parser = argparse.ArgumentParser()
parser.add_argument('--host', default='localhost')
parser.add_argument('--port', type=int, default=18080)
args = parser.parse_args()

BASE = f"http://{args.host}:{args.port}"
USER = os.environ.get('FLUX_RECOVERY_USER', 'Admin')
PASS = os.environ.get('FLUX_RECOVERY_PASS', '')
if not PASS:
    print("ERROR: Set FLUX_RECOVERY_PASS environment variable")
    sys.exit(1)

AUTH = base64.b64encode(f"{USER}:{PASS}".encode()).decode()
HEADERS = {"Authorization": f"Basic {AUTH}", "Content-Type": "application/json"}

DOMAIN   = os.environ.get('FLUX_DOMAIN', 'example.com')
HOSTNAME = os.environ.get('FLUX_HOSTNAME', f'mail.{DOMAIN}')
DB_HOST  = os.environ.get('FLUX_DB_HOST', '127.0.0.1')
DB_PORT  = int(os.environ.get('FLUX_DB_PORT', 5432))
DB_NAME  = os.environ.get('FLUX_DB_NAME', 'flux_mail')
DB_USER  = os.environ.get('FLUX_DB_USER', 'flux_mail')
DB_PASS  = os.environ.get('FLUX_DB_PASS', '')
if not DB_PASS:
    print("ERROR: Set FLUX_DB_PASS environment variable")
    sys.exit(1)
BLOB_DIR = os.environ.get('FLUX_BLOB_DIR', '/var/lib/flux/blobs')
LOG_DIR  = os.environ.get('FLUX_LOG_DIR', '/var/log/flux')


def jmap(calls):
    body = json.dumps({"using": ["urn:ietf:params:jmap:core"], "methodCalls": calls}).encode()
    req = urllib.request.Request(f"{BASE}/jmap", data=body, headers=HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


# Verify bootstrap mode
resp = jmap([["x:Bootstrap/get", {"accountId": "x", "ids": ["singleton"]}, "chk"]])
r = resp["methodResponses"][0]
if r[0] != "x:Bootstrap/get" or not r[1].get("list"):
    print(f"ERROR: Server is not in bootstrap mode (or wrong credentials): {r}")
    sys.exit(1)
print(f"[OK] Bootstrap mode active")

bootstrap_update = {
    "dataStore": {
        "@type": "PostgreSql",
        "host": DB_HOST, "port": DB_PORT, "database": DB_NAME,
        "authUsername": DB_USER,
        "authSecret": {"@type": "Value", "secret": DB_PASS},
        "useTls": False, "allowInvalidCerts": False,
        "poolMaxConnections": 10, "poolRecyclingMethod": "fast",
    },
    "blobStore": {"@type": "FileSystem", "path": BLOB_DIR, "depth": 2},
    "searchStore": {"@type": "Default"},
    "inMemoryStore": {"@type": "Default"},
    "directory": {"@type": "Internal"},
    "tracer": {
        "@type": "Log", "path": LOG_DIR, "prefix": "flux",
        "rotate": "daily", "ansi": False, "enable": True, "level": "info",
    },
    "serverHostname": HOSTNAME,
    "defaultDomain": DOMAIN,
    "requestTlsCertificate": False,
    "generateDkimKeys": False,   # generate via admin panel after start
    "dnsServer": {"@type": "Manual"},
}

print(f"\nConfiguring:")
print(f"  Domain:   {DOMAIN}  (e.g. user@{DOMAIN})")
print(f"  Hostname: {HOSTNAME}")
print(f"  Database: postgresql://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}")

resp = jmap([["x:Bootstrap/set", {"accountId": "x", "update": {"singleton": bootstrap_update}}, "bs1"]])
r = resp["methodResponses"][0]

if r[0] != "x:Bootstrap/set":
    print(f"ERROR: {r}")
    sys.exit(1)

errors = r[1].get("notUpdated", {})
if "singleton" in errors:
    print(f"ERROR: {json.dumps(errors['singleton'], indent=2)}")
    sys.exit(1)

result = r[1].get("updated", {}).get("singleton")
print(f"\n{'='*55}")
print(f"  SETUP COMPLETE")
print(f"{'='*55}")
if result:
    print(f"  Admin username: {result.get('username')}")
    print(f"  Admin password: {result.get('secret')}")
    print(f"\n  SAVE THESE CREDENTIALS — password not shown again")
print(f"{'='*55}")
print(f"\nNext: restart the flux service to apply configuration")
