# INBOX — Product Brief

Source of truth for marketing copy, landing pages, and ad creative.
Every fact below is drawn from the codebase, not from positioning aspiration.
Verified against commit `ab241f6`.

---

## 1. Identity

| | |
|---|---|
| **Product** | INBOX by Arham Workspace |
| **Category** | Business email hosting for Indian companies |
| **Marketing + company console** | `inbox.arhamworkspace.tech` |
| **User mail app** | `app.arhamworkspace.tech` |
| **One-liner** | Professional email at your own domain — India-hosted, no ads, ready in minutes. |

**The pitch in one sentence:** Stop running your business from `@gmail.com`. Get
`you@yourcompany.com` on infrastructure that lives in India, at roughly 20% under
what Zoho charges, with your existing mail imported for you.

---

## 2. Who it's for

- Indian SMBs and startups, 3–200 people
- Currently on Zoho Mail, Google Workspace, or a cPanel host they've outgrown
- Or still running the business from personal Gmail accounts
- Bought by a founder, office manager, or one technical person who "handles IT"

The buyer is *not* an email administrator. They do not know what an MX record is,
and the product is built so they never need to.

---

## 3. Positioning — what actually differentiates this

Ranked by how much weight each can carry in ad copy.

**1. One-click DNS setup via your registrar.**
Direct OAuth integrations with **Cloudflare, GoDaddy, Porkbun and DigitalOcean**.
The customer authorizes once and every record — MX, SPF, DKIM, DMARC, verification
TXT — is written for them. Neither Google nor Zoho does this. This is the strongest
differentiator and deserves to be the hero.

**2. Migration is included, not a professional-services upsell.**
Full mailbox import from **Zoho Mail, Google Workspace, cPanel/WHM, and any
Dovecot/IMAP server** — messages, folder structure, and read state. Checkpointed,
so a run that takes hours survives interruption and resumes where it stopped.

**3. India-hosted, with real data residency.**
AWS Mumbai (`ap-south-1`). Mail bodies and attachments sit in Indian S3 storage.
This is a factual infrastructure claim, not marketing language.

**4. ~20% under Zoho, like-for-like.**
Pricing is deliberately benchmarked against Zoho Mail India on the same
per-seat-per-month, ex-GST basis.

**5. No ads, no scanning.** Table stakes against Gmail, but worth saying plainly.

**6. Open standards throughout.** IMAP, SMTP, POP, ActiveSync, JMAP, CalDAV,
CardDAV. Nothing is locked in — which is also the honest answer to "what if we
want to leave later".

---

## 4. Pricing

Per seat, per month, in INR, **exclusive of GST**. 18% GST added at checkout.
Quoting ex-GST matches how Zoho quotes, so the comparison stays like-for-like.

| Plan | Price/seat/mo | Storage per mailbox | Domains | Notable |
|---|---|---|---|---|
| **Free Trial** | ₹0 | 5 GB | 1 | 3 mailboxes, 14 days |
| **Lite** | ₹40 | 5 GB | 30 | IMAP/POP/ActiveSync, free migration, email support |
| **Starter** | ₹60 | 10 GB | 30 | IMAP/POP/ActiveSync, free migration, email support |
| **Business** | ₹159 | 50 GB | 30 | + team aliases & distribution lists, priority support |
| **Enterprise** | ₹319 | 100 GB | 30 | + custom DKIM, dedicated support and SLA |

**Benchmark table (use this directly in comparison copy):**

| INBOX | | Zoho Mail India | Saving |
|---|---|---|---|
| Lite, 5 GB | ₹40 | Mail Lite 5 GB — ₹59 | −32% |
| Starter, 10 GB | ₹60 | Mail Lite 10 GB — ₹75 | −20% |
| Business, 50 GB | ₹159 | Mail Premium — ₹199 | −20% |
| Enterprise, 100 GB | ₹319 | Workplace Pro — ₹399 | −20% |

Notes that matter for accuracy:
- **Domain count is flat at 30 across every paid tier** — deliberately not gated by
  price. Don't write copy implying cheaper plans get fewer domains.
- Seats are unbounded by tier (hard ceiling 2,000).
- Trial is 3 mailboxes / 1 domain / 14 days, no card mentioned in the signup flow.

---

## 5. What the company admin gets (the console)

- **Domain management** — add a domain, verify ownership, auto-provision MX, SPF,
  DKIM (single-signature enforced) and DMARC
- **Registrar automation** — Cloudflare, GoDaddy, Porkbun, DigitalOcean via OAuth;
  manual DNS records as a fallback
- **Mailbox management** — create, delete, reset passwords, set per-mailbox storage
  quotas, view usage
- **Aliases and distribution lists** — up to 25 aliases per mailbox, up to 200
  recipients per list *(Business and Enterprise only)*
- **Migration console** — connect the old provider, discover mailboxes, select who
  to move, watch live per-user progress with message and byte counts
- **Billing** — Razorpay, per-seat, GST handled at checkout
- **Deliverability** — AWS SES identity management, DKIM tokens, bounce and
  complaint handling, suppression list

## 6. What the end user gets (the mail app)

The mail app is a mature, full-featured client — this section is under-sold on the
current landing page and is worth real space.

**Mail** — rich-text composer with inline images and tables; Gmail-style threading;
unified inbox across accounts; three layouts (three-pane split, focused list,
bottom reading pane); full-text search with filters, wildcards and OR conditions;
multi-select batch actions; color tags; starring; virtual scrolling for large
mailboxes; drag-out attachments to the desktop; forgotten-attachment warning;
`.eml` import; `winmail.dat` (TNEF) extraction; print from the viewer.

**Calendar** — month/week/day/agenda views; drag to reschedule with 15-minute snap;
recurring events with scoped edits; meeting invitations and RSVP (iMIP, RFC 5545);
`.ics` auto-detection inside emails; iCal/webcal subscriptions; tasks with due dates
and priority; shared calendars over CalDAV; auto-generated birthday calendar;
real-time sync.

**Contacts** — multiple address books, groups, vCard import/export with duplicate
detection, composer autocomplete.

**Rules & templates** — server-side filters with a visual rule builder (no Sieve
knowledge needed), a raw Sieve editor for people who want it, vacation responder
with date ranges, reusable templates with placeholders.

**Files** — built-in cloud storage browser with folder upload, progress tracking,
previews for images, text, audio and video, favorites and recents.

**Security** — external images blocked by default with a trusted-sender list; HTML
sanitization; S/MIME sign, encrypt, decrypt and verify; SPF/DKIM/DMARC status
indicators on every message; TOTP two-factor; OAuth2/OIDC with PKCE; one-click
newsletter unsubscribe.

**Interface** — dark and light themes with intelligent email color transformation;
responsive desktop, tablet and mobile; full keyboard navigation; drag-and-drop
organization; guided tour for new users; WCAG AA contrast, reduced-motion support
and screen-reader live regions.

**Languages** — 15, with automatic browser detection: English, Français, 日本語,
Español, Italiano, Deutsch, Nederlands, Português, Русский, Türkçe, 한국어, Polski,
Latviešu, 简体中文, Українська.

**Multi-account** — several accounts signed in at once with instant switching, and
multiple sender identities each with its own signature.

## 7. Mobile

Native Android and iOS apps (Capacitor shell around the mail app) with **push
notifications that arrive when the app is backgrounded or killed**, splash screen,
proper app icons, and hardware back-button handling.

⚠️ Confirm current App Store / Play Store listing status before writing "download
on the App Store" copy — the repo shows a built app at versionCode 2, targeting
Android API 36, but store availability isn't something I can verify from here.

---

## 8. The three-step story

The current landing page frames onboarding as **Add your domain → Set DNS records →
Start sending**. Given the registrar automation, the middle step undersells the
product. Better framing:

> **Add your domain → Connect your registrar → Import your old mail**

"Set DNS records" describes the fallback path as though it were the main one.

---

## 9. Tone and copy rules

**Voice:** plain, concrete, slightly technical, no hype. The audience is a busy
founder who has been burned by a hosting company before. Specific numbers beat
adjectives. "5 GB per mailbox, ₹40 a month" is better than "generous storage at an
unbeatable price."

**Use these words:** India-hosted. No ads. Your domain. Import everything. Minutes,
not days. Open standards.

**Avoid:** "revolutionary", "seamless", "empower", "solution", "next-generation",
"AI-powered" (the AI draft feature exists but is not a positioning pillar).

**Claims that must stay true:**
- Prices are ex-GST — say so, or quote the GST-inclusive figure
- Team aliases and distribution lists are **Business and Enterprise only**
- 30 domains applies to **every paid plan**, not as a premium upsell
- Migration covers Zoho, Google Workspace, cPanel/WHM and generic IMAP — don't
  imply support for Outlook.com, Rediffmail or Proton, which aren't built
- Don't claim an SLA outside Enterprise
- Don't claim uptime figures — no measured number exists yet

---

## 10. Suggested page structure

1. **Hero** — `you@yourcompany.com`, India-hosted, no ads. Single CTA. Make the
   field a **company domain**, not an email address: it qualifies the lead and lets
   you detect their current provider before asking for a password.
2. **Registrar automation** — the differentiator, shown as a real flow with the four
   registrar logos.
3. **Migration** — "Switching from Zoho or Google? We move everything." Name the
   four supported sources explicitly.
4. **The mail app** — a proper screenshot section. Calendar, contacts, rules, files.
   This is the most under-sold asset.
5. **Pricing** — four tiers with the Zoho comparison column visible.
6. **India-hosted** — AWS Mumbai, data residency, no ad scanning.
7. **Mobile** — apps with real push notifications.
8. **FAQ** — "what if we want to leave?" (open standards, IMAP export), "how long
   does migration take?", "is GST included?", "can we keep our domain registrar?"
9. **Final CTA** — 14-day trial, 3 mailboxes, no card.

---

## 11. Technical facts (for FAQ and trust sections)

- Mail server: Stalwart, JMAP-native
- Protocols: IMAP, SMTP, POP3, ActiveSync, JMAP, CalDAV, CardDAV, WebDAV
- Hosting: AWS `ap-south-1` (Mumbai); mail bodies and attachments in Indian S3
- Outbound deliverability: AWS SES with per-domain DKIM identities, bounce and
  complaint handling, suppression list
- Auth: OAuth2 + PKCE; TOTP two-factor available
- Encryption: S/MIME signing and encryption supported in the client
- Mail app is a PWA — installable, with web push
