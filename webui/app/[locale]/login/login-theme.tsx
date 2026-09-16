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
        /* Palette Tokens */
        --color-primary: #0866F5;
        --color-primary-hover: #0756D8;
        --color-primary-foreground: #FFFFFF;

        --color-accent: #EEF5FF;
        --color-accent-foreground: #0866F5;

        --color-background: #F7FAFF;
        --color-foreground: #0B1739;

        --color-card: #FFFFFF;
        --color-card-foreground: #0B1739;

        --color-popover: #FFFFFF;
        --color-popover-foreground: #0B1739;

        --color-border: #E2EAF5;
        --color-input: #E2EAF5;
        --color-ring: #35A8FF;

        --color-secondary: #EEF5FF;
        --color-secondary-foreground: #0866F5;

        --color-muted: #EEF5FF;
        --color-muted-foreground: #607392;

        --color-destructive: #EF4444;
        --color-destructive-foreground: #FFFFFF;

        --color-success: #10B981;
        --color-success-foreground: #FFFFFF;

        --color-warning: #F5A800;
        --color-warning-foreground: #0B1739;

        --color-unread: #0875FF;
        --color-star: #F5A800;

        --il-accent: #0866F5;
        --il-accent-hover: #0756D8;
        --il-accent-light: #35A8FF;
        --il-accent-soft: #EEF5FF;

        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background-color: #F7FAFF;
        color: #0B1739;
      }

      :root.dark .inbox-login,
      .dark .inbox-login {
        --color-background: #070D1E;
        --color-foreground: #F7FAFF;
        --color-card: #0B1739;
        --color-card-foreground: #F7FAFF;
        --color-popover: #0B1739;
        --color-popover-foreground: #F7FAFF;
        --color-border: #1E2D4A;
        --color-input: #1E2D4A;
        --color-secondary: #132247;
        --color-muted: #132247;
        --color-muted-foreground: #94A3B8;
        --il-accent-soft: rgba(8, 102, 245, 0.18);
        background-color: #070D1E;
        color: #F7FAFF;
      }

      .inbox-login::before {
        content: "";
        position: absolute; inset: 0; pointer-events: none; z-index: 0;
        background: radial-gradient(ellipse 65% 55% at 50% -8%, rgba(8, 102, 245, 0.12), transparent 70%);
      }
      .inbox-login > * { position: relative; z-index: 1; }

      .inbox-login .il-wordmark {
        background: linear-gradient(90deg, #0866F5, #35A8FF);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }

      .inbox-login .il-card {
        background-color: #FFFFFF !important;
        border-color: #E2EAF5 !important;
        box-shadow: 0 20px 50px rgba(11, 23, 57, 0.08), 0 4px 12px rgba(11, 23, 57, 0.03);
      }
      :root.dark .inbox-login .il-card,
      .dark .inbox-login .il-card {
        background-color: #0B1739 !important;
        border-color: #1E2D4A !important;
        box-shadow: 0 24px 64px rgba(0,0,0,.45), 0 8px 24px rgba(0,0,0,.3);
      }

      .inbox-login .il-chip {
        display: flex; align-items: center; gap: 8px; margin-top: 8px;
        padding: 9px 12px; border-radius: 10px;
        background: #EEF5FF; border: 1px solid #E2EAF5;
        font-size: 12.5px; color: #0866F5;
      }
      .inbox-login .il-chip svg {
        width: 15px; height: 15px; flex: none; border-radius: 50%;
        background: #0866F5; color: #FFFFFF; padding: 2px;
      }
      .inbox-login .il-chip b { font-weight: 700; color: #0B1739; }

      .inbox-login .il-oauth {
        width: 100%; height: 44px; border-radius: 0.75rem;
        display: flex; align-items: center; justify-content: center; gap: 10px;
        font-weight: 500; font-size: 15px;
        border: 1px solid #E2EAF5;
        background: #FFFFFF; color: #0B1739;
        transition: all .2s ease;
      }
      .inbox-login .il-oauth:hover:not(:disabled) {
        background: #EEF5FF;
        border-color: #35A8FF;
        color: #0866F5;
      }
      .inbox-login .il-oauth svg { width: 18px; height: 18px; flex: none; }

      /* top bar */
      .inbox-login .il-topbar {
        position: sticky; top: 0; z-index: 20; width: 100%;
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 14px 20px calc(14px) 20px;
        padding-top: calc(14px + env(safe-area-inset-top, 0px));
        border-bottom: 1px solid #E2EAF5;
        background: rgba(247, 250, 255, 0.88);
        backdrop-filter: blur(10px);
      }
      :root.dark .inbox-login .il-topbar,
      .dark .inbox-login .il-topbar {
        border-bottom: 1px solid #1E2D4A;
        background: rgba(7, 13, 30, 0.88);
      }
      .inbox-login .il-topbrand { display: flex; align-items: center; gap: 9px; font-weight: 800; font-size: 15px; color: #0B1739; }
      :root.dark .inbox-login .il-topbrand,
      .dark .inbox-login .il-topbrand { color: #F7FAFF; }
      .inbox-login .il-topbrand img { width: 24px; height: 24px; flex: none; }
      .inbox-login .il-topbrand .il-sub { font-weight: 500; color: #607392; font-size: 12.5px; }
      .inbox-login .il-topbrand .il-host { font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .inbox-login .il-topright { display: flex; align-items: center; gap: 10px; }
      .inbox-login .il-admin-link {
        font-size: 12.5px; font-weight: 600; color: #607392; text-decoration: none;
        display: none;
      }
      .inbox-login .il-admin-link:hover { color: #0866F5; }
      @media (min-width: 560px) { .inbox-login .il-admin-link { display: inline; } }

      /* card badge */
      .inbox-login .il-badge {
        display: inline-flex; align-items: center; font-size: 10.5px; font-weight: 800;
        letter-spacing: .04em; text-transform: uppercase; color: #0866F5;
        background: #EEF5FF; border: 1px solid #E2EAF5;
        padding: 3px 9px; border-radius: 999px; vertical-align: middle; margin-left: 8px;
      }

      /* input icon slots & input styling */
      .inbox-login .il-inputwrap { position: relative; }
      .inbox-login .il-inputwrap svg.il-inputicon {
        position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
        width: 16px; height: 16px; color: #94A3B8; pointer-events: none;
      }
      .inbox-login .il-inputwrap input { padding-left: 38px !important; }

      .inbox-login input,
      .inbox-login select {
        color: #0B1739 !important;
        border-color: #E2EAF5 !important;
        background-color: #FFFFFF !important;
      }
      .inbox-login input::placeholder {
        color: #94A3B8 !important;
      }
      .inbox-login input:focus,
      .inbox-login select:focus {
        border-color: #0866F5 !important;
        box-shadow: 0 0 0 3px rgba(53, 168, 255, 0.25) !important;
      }

      :root.dark .inbox-login input,
      :root.dark .inbox-login select,
      .dark .inbox-login input,
      .dark .inbox-login select {
        color: #F7FAFF !important;
        border-color: #1E2D4A !important;
        background-color: #070D1E !important;
      }
      :root.dark .inbox-login input::placeholder,
      .dark .inbox-login input::placeholder {
        color: #607392 !important;
      }
      :root.dark .inbox-login input:focus,
      :root.dark .inbox-login select:focus,
      .dark .inbox-login input:focus,
      .dark .inbox-login select:focus {
        border-color: #35A8FF !important;
        box-shadow: 0 0 0 3px rgba(8, 102, 245, 0.35) !important;
      }

      /* Primary buttons */
      .inbox-login button[type="submit"],
      .inbox-login .bg-primary {
        background-color: #0866F5 !important;
        color: #FFFFFF !important;
        box-shadow: 0 4px 14px rgba(8, 102, 245, 0.25) !important;
      }
      .inbox-login button[type="submit"]:hover:not(:disabled),
      .inbox-login .bg-primary:hover:not(:disabled) {
        background-color: #0756D8 !important;
        box-shadow: 0 6px 20px rgba(8, 102, 245, 0.35) !important;
      }

      /* soft blurred backdrop hinting at the app behind the card */
      .inbox-login .il-backdrop {
        position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
        opacity: .5; filter: blur(2px);
        -webkit-mask-image: linear-gradient(180deg, transparent, black 15%, black 75%, transparent);
        mask-image: linear-gradient(180deg, transparent, black 15%, black 75%, transparent);
      }
      .inbox-login .il-backdrop .il-bd-row {
        display: flex; align-items: center; gap: 10px; max-width: 640px; margin: 0 auto 14px;
        padding: 12px 18px; border-radius: 12px; background: #FFFFFF; border: 1px solid #E2EAF5;
      }
      .inbox-login .il-backdrop .il-bd-dot { width: 8px; height: 8px; border-radius: 50%; background: #0875FF; flex: none; }
      .inbox-login .il-backdrop .il-bd-line { height: 9px; border-radius: 5px; background: #EEF5FF; }

      :root.dark .inbox-login .il-backdrop .il-bd-row,
      .dark .inbox-login .il-backdrop .il-bd-row {
        background: #0B1739; border: 1px solid #1E2D4A;
      }
      :root.dark .inbox-login .il-backdrop .il-bd-line,
      .dark .inbox-login .il-backdrop .il-bd-line {
        background: #132247;
      }

      /* footer */
      .inbox-login .il-foot {
        display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap;
        margin-top: 26px; padding-bottom: max(20px, env(safe-area-inset-bottom, 0px));
        font-size: 12px; color: #607392;
      }
      .inbox-login .il-foot a { color: #607392; text-decoration: none; }
      .inbox-login .il-foot a:hover { color: #0866F5; text-decoration: underline; }
      .inbox-login .il-foot .il-dot { opacity: .5; color: #94A3B8; }
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
        <img src="/icon-512x512.png" alt="" />
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
