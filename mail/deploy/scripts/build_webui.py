#!/usr/bin/env python3
"""
Download the Stalwart webui, apply Flux branding patches, and save as webui-flux.zip.

Changes applied:
1. Iee() SVG wordmark: fill-current → #db2d54 (Flux red, visible light/dark mode)
2. Iee() aria-label: "Stalwart Logo" → "Logo"
3. stalwartAlt i18n key value: "Stalwart Logo" → "Logo"
4. Post-login header: Iee() (static SVG) → Lee() (fetches /logo dynamically)
5. Lee() while loading: returns null instead of Iee() (no flash of Stalwart SVG)

NOTE: Do NOT add sub_filter stalwart→flux in nginx for JS/JSON — it breaks
      JMAP capability URN urn:stalwart:jmap, causing 400 errors in the admin panel.
"""
import sys, io, zipfile, urllib.request

WEBUI_URL = "https://github.com/stalwartlabs/webui/releases/latest/download/webui.zip"
OUTPUT_PATH = "webui-flux.zip"

if len(sys.argv) > 1:
    OUTPUT_PATH = sys.argv[1]

print(f"Downloading {WEBUI_URL}...")
req = urllib.request.Request(WEBUI_URL, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req, timeout=120) as r:
    zip_data = r.read()
print(f"Downloaded {len(zip_data):,} bytes")

in_buf = io.BytesIO(zip_data)
out_buf = io.BytesIO()
changes = []

with zipfile.ZipFile(in_buf, 'r') as zin:
    names = zin.namelist()
    print(f"Files: {names}")
    with zipfile.ZipFile(out_buf, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
        for name in names:
            data = zin.read(name)
            if name.endswith('.js') and b'fill-current' in data and b'Stalwart Logo' in data:
                print(f"Patching {name}...")
                text = data.decode('utf-8')

                patches = [
                    # 1. Fix Iee() aria-label
                    ('"aria-label":e(`logo.stalwartAlt`,`Stalwart Logo`)',
                     '"aria-label":e(`logo.alt`,`Logo`)',
                     'aria-label'),
                    # 2. Fix i18n translation value
                    ('stalwartAlt:`Stalwart Logo`',
                     'stalwartAlt:`Logo`',
                     'stalwartAlt translation'),
                    # 3. Fix wordmark color fill-current → Flux red
                    ('className:`fill-current`,d:`M227.8 143.6',
                     'fill:`#db2d54`,d:`M227.8 143.6',
                     'wordmark color → #db2d54'),
                    # 4. Post-login header: Iee → Lee (fetches /logo dynamically)
                    ('children:(0,H.jsx)(Iee,{})}),(0,H.jsx)(`main`',
                     'children:(0,H.jsx)(Lee,{})}),(0,H.jsx)(`main`',
                     'header uses Lee()'),
                    # 5. Lee() while loading: null instead of Iee()
                    ('`}):(0,H.jsx)(Iee,{})}var eB',
                     '`}):r?(0,H.jsx)(Iee,{}):null}var eB',
                     'Lee() null while loading'),
                ]

                for old, new, label in patches:
                    if old in text:
                        text = text.replace(old, new)
                        changes.append(label)
                    else:
                        print(f"  [WARN] Pattern not found: {label}")

                data = text.encode('utf-8')
            zout.writestr(name, data)

out_buf.seek(0)
with open(OUTPUT_PATH, 'wb') as f:
    f.write(out_buf.read())

print(f"\nSaved to: {OUTPUT_PATH}")
print(f"Applied {len(changes)} patches: {', '.join(changes)}")
