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
    `}</style>
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
