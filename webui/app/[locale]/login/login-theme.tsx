/**
 * Visual polish for the login page, echoing the INBOX marketing landing page
 * (console-app/public/landing.html) — same accent blue, same soft radial
 * glow, same Plus Jakarta Sans display face, same gradient-text treatment
 * used there for "your domain".
 *
 * Deliberately layered on top of the page's existing Tailwind semantic
 * classes (bg-primary, text-foreground, border-border, destructive/warning/
 * info alert colors, focus rings) rather than replacing them — those are
 * wired to this app's real theme tokens (app/globals.css's --color-*
 * variables, --color-primary: #1a73e8), consumed everywhere past this page
 * too. Overriding them here would mean either reskinning the whole app's
 * accent color (unasked, and a much bigger blast radius than "the login
 * screen") or drifting this one page out of sync with it. What's added
 * instead is decorative only: the background glow, the brand-blue gradient
 * on the wordmark, and the display font — the same layering approach used
 * for console-app's login/signup (see its app/auth-theme.tsx).
 *
 * Plain <style>/<link> tags rendered from a client component are valid HTML
 * and, in practice, scoped to this route: Next.js removes them along with
 * the rest of this component's DOM on navigation.
 */
import type { ReactNode } from "react";

export function LoginStyles() {
  return (
    <style>{`
      .inbox-login {
        --il-accent: #2F56FF;
        --il-accent-soft: color-mix(in srgb, var(--il-accent) 10%, transparent);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .inbox-login::before {
        content: "";
        position: absolute; inset: 0; pointer-events: none; z-index: 0;
        background: radial-gradient(ellipse 65% 55% at 50% -8%, var(--il-accent-soft), transparent 70%);
      }
      .inbox-login > * { position: relative; z-index: 1; }
      .inbox-login .il-wordmark {
        background: linear-gradient(90deg, var(--il-accent), #7CACFF);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .inbox-login .il-card {
        box-shadow: 0 24px 64px rgba(10,18,40,.12), 0 8px 24px rgba(10,18,40,.07);
      }
      :root.dark .inbox-login .il-card {
        box-shadow: 0 24px 64px rgba(0,0,0,.45), 0 8px 24px rgba(0,0,0,.3);
      }
      .inbox-login .il-chip {
        display: flex; align-items: center; gap: 8px; margin-top: 8px;
        padding: 9px 12px; border-radius: 10px;
        background: var(--il-accent-soft); border: 1px solid color-mix(in srgb, var(--il-accent) 22%, transparent);
        font-size: 12.5px; color: var(--il-accent);
      }
      .inbox-login .il-chip svg {
        width: 15px; height: 15px; flex: none; border-radius: 50%;
        background: var(--il-accent); color: #fff; padding: 2px;
      }
      .inbox-login .il-chip b { font-weight: 700; }
      .inbox-login .il-oauth {
        width: 100%; height: 44px; border-radius: 0.75rem;
        display: flex; align-items: center; justify-content: center; gap: 10px;
        font-weight: 500; font-size: 15px;
        border: 1px solid var(--color-border);
        background: var(--color-background); color: var(--color-foreground);
        transition: background-color .2s ease;
      }
      .inbox-login .il-oauth:hover:not(:disabled) { background: var(--color-muted); }
      .inbox-login .il-oauth svg { width: 18px; height: 18px; flex: none; }

      /* top bar */
      .inbox-login .il-topbar {
        position: sticky; top: 0; z-index: 20; width: 100%;
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 14px 20px calc(14px) 20px;
        padding-top: calc(14px + env(safe-area-inset-top, 0px));
        border-bottom: 1px solid var(--color-border);
        background: color-mix(in srgb, var(--color-background) 88%, transparent);
        backdrop-filter: blur(10px);
      }
      .inbox-login .il-topbrand { display: flex; align-items: center; gap: 9px; font-weight: 800; font-size: 15px; color: var(--color-foreground); }
      .inbox-login .il-topbrand img { width: 24px; height: 24px; flex: none; }
      .inbox-login .il-topbrand .il-sub { font-weight: 500; color: var(--color-muted-foreground); font-size: 12.5px; }
      .inbox-login .il-topbrand .il-host { font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .inbox-login .il-topright { display: flex; align-items: center; gap: 10px; }
      .inbox-login .il-admin-link {
        font-size: 12.5px; font-weight: 600; color: var(--color-muted-foreground); text-decoration: none;
        display: none;
      }
      .inbox-login .il-admin-link:hover { color: var(--color-foreground); }
      @media (min-width: 560px) { .inbox-login .il-admin-link { display: inline; } }

      /* card badge */
      .inbox-login .il-badge {
        display: inline-flex; align-items: center; font-size: 10.5px; font-weight: 800;
        letter-spacing: .04em; text-transform: uppercase; color: var(--il-accent);
        background: var(--il-accent-soft); border: 1px solid color-mix(in srgb, var(--il-accent) 22%, transparent);
        padding: 3px 9px; border-radius: 999px; vertical-align: middle; margin-left: 8px;
      }

      /* input icon slots */
      .inbox-login .il-inputwrap { position: relative; }
      .inbox-login .il-inputwrap svg.il-inputicon {
        position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
        width: 16px; height: 16px; color: var(--color-muted-foreground); pointer-events: none;
      }
      .inbox-login .il-inputwrap input { padding-left: 38px !important; }

      /* soft blurred backdrop hinting at the app behind the card */
      .inbox-login .il-backdrop {
        position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
        opacity: .5; filter: blur(2px);
        -webkit-mask-image: linear-gradient(180deg, transparent, black 15%, black 75%, transparent);
        mask-image: linear-gradient(180deg, transparent, black 15%, black 75%, transparent);
      }
      .inbox-login .il-backdrop .il-bd-row {
        display: flex; align-items: center; gap: 10px; max-width: 640px; margin: 0 auto 14px;
        padding: 12px 18px; border-radius: 12px; background: var(--color-card); border: 1px solid var(--color-border);
      }
      .inbox-login .il-backdrop .il-bd-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--il-accent); flex: none; }
      .inbox-login .il-backdrop .il-bd-line { height: 9px; border-radius: 5px; background: var(--color-muted); }

      /* footer */
      .inbox-login .il-foot {
        display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;
        margin-top: 26px; padding-bottom: max(20px, env(safe-area-inset-bottom, 0px));
        font-size: 12px; color: var(--color-muted-foreground);
      }
      .inbox-login .il-foot a { color: var(--color-muted-foreground); text-decoration: none; }
      .inbox-login .il-foot a:hover { color: var(--color-foreground); text-decoration: underline; }
      .inbox-login .il-foot .il-dot { opacity: .5; }
    `}</style>
  );
}

/**
 * The top bar's right side deliberately does not offer Registration /
 * Forgot Password / Reset Success links, unlike some webmail login
 * mockups — this app has no self-service account creation or password
 * reset flow (grep confirms no such routes exist anywhere in app/).
 * Mailboxes are provisioned by an org admin via the console
 * (inbox.arhamworkspace.tech/dashboard/users); password changes happen
 * from inside the app's own settings once signed in, via Stalwart's
 * admin API. Linking to pages that don't exist would be worse than not
 * having the tabs; the admin-console link below is the one real,
 * existing destination worth surfacing here instead.
 */
export function LoginTopBar({ host, adminHref, children }: { host: string; adminHref: string; children?: ReactNode }) {
  return (
    <div className="il-topbar">
      <div className="il-topbrand">
        <img src="/icon/web/icon-512.png" alt="" />
        INBOX <span className="il-sub">Business Mail</span>
        {host && <span className="il-sub">· <span className="il-host">{host}</span></span>}
      </div>
      <div className="il-topright">
        <a className="il-admin-link" href={adminHref}>Admin console →</a>
        {children}
      </div>
    </div>
  );
}

export function LoginFonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap"
        rel="stylesheet"
      />
    </>
  );
}
