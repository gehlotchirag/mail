/**
 * Shared visual language for the console's auth pages (login, signup —
 * forgot/reset-password still carry the old look and were out of scope),
 * matching the marketing landing page (public/landing.html) rather than the
 * dashboard's own design system in globals.css.
 *
 * Deliberately not globals.css: that file already defines unscoped .field,
 * .label, .inp, .btn etc. for the dashboard, with different values
 * (--accent: #2563eb there vs #2F56FF on the landing page). Reusing those
 * class names here would mean every rule below has to out-specificity and
 * override every property the global one sets, forever — one missed
 * property and it silently leaks through. Prefixing everything under
 * .authpage with a- avoids that class of bug entirely rather than relying on
 * specificity to win it.
 *
 * A plain <style> tag rendered from within a client component's JSX is valid
 * HTML (style elements are allowed in body) and is scoped to this render
 * tree in practice — it exists only while the page that renders it is
 * mounted, and Next.js unmounts it on navigation like any other DOM node
 * these components own. That's what makes it safe to declare --bg, --accent
 * etc. here without touching :root and the dashboard's own tokens.
 */
export function AuthStyles() {
  return (
    <style>{`
      .authpage {
        --bg: #F4F7FF;
        --surface: #FFFFFF;
        --surface2: #F0F4FF;
        --ink: #0A1228;
        --ink2: #374264;
        --muted: #7A8CAE;
        --border: rgba(10,18,40,.09);
        --accent: #2F56FF;
        --accentd: rgba(47,86,255,.10);
        --green: #0B9E58;
        --danger: #dc2626;
        --shadow-m: 0 4px 20px rgba(10,18,40,.09), 0 2px 8px rgba(10,18,40,.05);
        --shadow-l: 0 24px 64px rgba(10,18,40,.12), 0 8px 24px rgba(10,18,40,.07);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        min-height: 100vh;
        background: var(--bg);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
        position: relative;
        overflow: hidden;
      }
      .authpage::before {
        content: "";
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(ellipse 60% 50% at 50% -10%, var(--accentd), transparent 70%);
      }
      .authpage .a-wrap { position: relative; width: 100%; max-width: 408px; }
      .authpage .a-back {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 13.5px; font-weight: 600; color: var(--muted);
        margin-bottom: 28px;
      }
      .authpage .a-back:hover { color: var(--ink); }
      .authpage .a-back svg { width: 14px; height: 14px; }
      .authpage .a-brand { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 26px; }
      .authpage .a-brand img { width: 44px; height: 44px; margin-bottom: 14px; }
      .authpage .a-brand h1 { font-size: 22px; font-weight: 800; color: var(--ink); letter-spacing: -.02em; margin-bottom: 6px; }
      .authpage .a-brand p { font-size: 14px; color: var(--muted); }
      .authpage .a-card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow-l); padding: 32px; }
      .authpage .a-field { margin-bottom: 18px; }
      .authpage .a-field:last-of-type { margin-bottom: 0; }
      .authpage .a-label { display: block; font-size: 13px; font-weight: 700; color: var(--ink2); margin-bottom: 7px; }
      .authpage .a-hint { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
      .authpage .a-input {
        width: 100%; padding: 11px 14px; background: var(--surface2);
        border: 1px solid var(--border); border-radius: 10px; color: var(--ink);
        font-size: 14.5px; font-family: inherit; outline: none;
        transition: border-color .15s ease, background .15s ease;
      }
      .authpage .a-input:focus { border-color: var(--accent); background: var(--surface); }
      .authpage .a-input::placeholder { color: var(--muted); }
      .authpage .a-pwwrap { position: relative; }
      .authpage .a-pwwrap .a-input { padding-right: 44px; }
      .authpage .a-pwtoggle {
        position: absolute; top: 0; bottom: 0; right: 0; width: 44px;
        display: flex; align-items: center; justify-content: center;
        background: none; border: none; cursor: pointer; color: var(--muted); padding: 0;
      }
      .authpage .a-pwtoggle:hover { color: var(--ink2); }
      .authpage .a-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 7px; }
      .authpage .a-row .a-label { margin-bottom: 0; }
      .authpage .a-link { color: var(--accent); font-size: 13px; font-weight: 700; text-decoration: none; }
      .authpage .a-link:hover { text-decoration: underline; }
      .authpage .a-alert {
        background: rgba(220,38,38,.07); border: 1px solid rgba(220,38,38,.25);
        color: var(--danger); border-radius: 10px; padding: 11px 14px;
        font-size: 13.5px; margin-bottom: 18px; line-height: 1.5;
      }
      .authpage .a-submit {
        width: 100%; margin-top: 22px; padding: 13px; background: var(--accent); color: #fff;
        border: none; border-radius: 10px; font-weight: 700; font-size: 15px; font-family: inherit;
        cursor: pointer; box-shadow: var(--shadow-m);
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: transform .12s ease, box-shadow .2s ease, opacity .15s ease;
      }
      .authpage .a-submit svg { width: 16px; height: 16px; }
      .authpage .a-submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: var(--shadow-l); }
      .authpage .a-submit:disabled { opacity: .6; cursor: not-allowed; transform: none; }
      .authpage .a-divider { display: flex; align-items: center; gap: 12px; margin: 22px 0; font-size: 12px; color: var(--muted); }
      .authpage .a-divider::before, .authpage .a-divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }
      .authpage .a-foot { text-align: center; color: var(--muted); font-size: 13.5px; }
      .authpage .a-foot a { color: var(--accent); font-weight: 700; text-decoration: none; }
      .authpage .a-foot a:hover { text-decoration: underline; }
      .authpage .a-legal { text-align: center; margin: 22px auto 0; color: var(--muted); font-size: 12px; max-width: 340px; line-height: 1.6; }
      .authpage .a-legal a { color: var(--ink2); }
      .authpage .a-pwreqs { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
      .authpage .a-req { display: flex; align-items: center; gap: 7px; font-size: 12.5px; }
      .authpage .a-req svg { width: 13px; height: 13px; flex: none; }
      .authpage .a-req.met { color: var(--green); }
      .authpage .a-req.unmet { color: var(--muted); }
      @media (max-width: 480px) {
        .authpage .a-card { padding: 24px 20px; border-radius: 14px; }
      }
    `}</style>
  );
}

export function AuthFonts() {
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

export function BackToHome() {
  return (
    <a href="/" className="a-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Back to INBOX
    </a>
  );
}
