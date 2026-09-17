/**
 * Shared visual language for the console's auth pages (login, signup,
 * forgot-password, reset-password), matching the marketing landing page
 * (public/landing.html) rather than the dashboard's own design system in
 * globals.css.
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
 * mounted, and Next.js unmounts it with the rest of the component tree on
 * navigation.
 */
export function AuthStyles() {
  return (
    <style>{`
      .authpage {
        --bg: #F7FAFF;
        --surface: #FFFFFF;
        --surface2: #EEF5FF;
        --ink: #0B1739;
        --ink2: #607392;
        --muted: #94A3B8;
        --border: #E2EAF5;
        --accent: #0866F5;
        --accent-hover: #0756D8;
        --accentd: #EEF5FF;
        --green: #10B981;
        --danger: #EF4444;
        --shadow-m: 0 4px 20px rgba(11, 23, 57, 0.07), 0 2px 8px rgba(11, 23, 57, 0.04);
        --shadow-l: 0 20px 50px rgba(11, 23, 57, 0.09), 0 4px 16px rgba(11, 23, 57, 0.04);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        min-height: 100vh;
        display: grid;
        grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
        background: var(--bg);
      }

      /* ── Left panel — brand, fixed across every auth page ───────────── */
      .authpage .a-panel {
        position: relative;
        background: linear-gradient(165deg, #0A1228, #101B3A 55%, #0A1228);
        color: #fff;
        padding: 44px 48px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .authpage .a-panel::before {
        content: "";
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(ellipse 70% 55% at 20% 0%, rgba(47,86,255,.35), transparent 60%);
      }
      .authpage .a-panel::after {
        content: "";
        position: absolute; inset: 0; pointer-events: none;
        background-image:
          linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
        background-size: 34px 34px;
        mask-image: linear-gradient(180deg, black, transparent 75%);
      }
      .authpage .a-panel > * { position: relative; z-index: 1; }

      .authpage .a-brandrow { display: flex; align-items: center; gap: 10px; margin-bottom: 44px; }
      .authpage .a-brandrow img { width: 34px; height: 34px; flex: none; }
      .authpage .a-brandrow .a-word { font-weight: 800; font-size: 18px; letter-spacing: -.02em; }
      .authpage .a-brandrow .a-pill {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
        color: #BFD0FF; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14);
        padding: 3px 8px; border-radius: 999px;
      }
      .authpage .a-brandrow .a-sub { font-size: 12px; color: rgba(255,255,255,.5); margin-left: 2px; }

      .authpage .a-panel h1 {
        font-size: clamp(28px, 3vw, 36px); font-weight: 800; line-height: 1.12; letter-spacing: -.025em;
        margin-bottom: 16px; text-wrap: balance;
      }
      .authpage .a-panel h1 .a-grad {
        background: linear-gradient(90deg, #8AAAFF, #BFD6FF);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .authpage .a-panel .a-lede { font-size: 15px; color: rgba(255,255,255,.62); max-width: 38ch; line-height: 1.6; margin-bottom: 36px; }

      .authpage .a-feats { display: flex; flex-direction: column; gap: 1px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; overflow: hidden; margin-bottom: auto; }
      .authpage .a-feat { display: flex; align-items: center; gap: 13px; background: rgba(10,18,40,.55); padding: 14px 16px; }
      .authpage .a-feat .a-num {
        width: 26px; height: 26px; border-radius: 8px; flex: none; display: grid; place-items: center;
        font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 700;
        background: rgba(138,170,255,.16); color: #8AAAFF; border: 1px solid rgba(138,170,255,.25);
      }
      .authpage .a-feat strong { display: block; font-size: 13.5px; font-weight: 700; }
      .authpage .a-feat span { display: block; font-size: 12px; color: rgba(255,255,255,.5); margin-top: 1px; }

      .authpage .a-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,.08); border-top: 1px solid rgba(255,255,255,.1); margin-top: 28px; }
      .authpage .a-stat { padding: 14px 4px 2px; text-align: left; }
      .authpage .a-stat b { display: block; font-size: 13.5px; font-weight: 700; color: #fff; }
      .authpage .a-stat span { font-size: 11px; color: rgba(255,255,255,.45); }

      .authpage .a-panelfoot { display: flex; align-items: center; gap: 6px; margin-top: 22px; font-size: 11.5px; color: rgba(255,255,255,.4); }
      .authpage .a-panelfoot svg { width: 13px; height: 13px; flex: none; }

      /* ── Right panel — the actual form ──────────────────────────────── */
      .authpage .a-right { display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
      .authpage .a-wrap { width: 100%; max-width: 408px; }

      .authpage .a-crumb { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; flex-wrap: wrap; }
      .authpage .a-tag {
        font-size: 12px; font-weight: 700; color: var(--accent); background: var(--accentd);
        border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
        padding: 5px 11px; border-radius: 999px;
      }
      .authpage .a-crumb .a-host { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: var(--muted); }

      .authpage .a-title { font-size: 26px; font-weight: 800; color: var(--ink); letter-spacing: -.02em; margin-bottom: 8px; }
      .authpage .a-desc { font-size: 14.5px; color: var(--muted); line-height: 1.55; margin-bottom: 26px; max-width: 40ch; }

      .authpage .a-card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow-l); padding: 30px; }
      .authpage .a-field { margin-bottom: 18px; }
      .authpage .a-field:last-of-type { margin-bottom: 0; }
      .authpage .a-label { display: block; font-size: 11.5px; font-weight: 700; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
      .authpage .a-hint { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
      .authpage .a-inputwrap { position: relative; }
      .authpage .a-inputwrap .a-ic { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--muted); pointer-events: none; }
      .authpage .a-input {
        width: 100%; padding: 12px 14px; background: var(--surface2);
        border: 1px solid var(--border); border-radius: 10px; color: var(--ink);
        font-size: 14.5px; font-family: inherit; outline: none;
        transition: border-color .15s ease, background .15s ease;
      }
      .authpage .a-inputwrap .a-ic ~ .a-input { padding-left: 40px; }
      .authpage .a-input:focus { border-color: var(--accent); background: var(--surface); }
      .authpage .a-input::placeholder { color: var(--muted); }
      .authpage .a-pwwrap .a-input { padding-right: 44px; }
      .authpage .a-pwtoggle {
        position: absolute; top: 0; bottom: 0; right: 0; width: 44px;
        display: flex; align-items: center; justify-content: center;
        background: none; border: none; cursor: pointer; color: var(--muted); padding: 0;
      }
      .authpage .a-pwtoggle:hover { color: var(--ink2); }
      .authpage .a-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
      .authpage .a-row .a-label { margin-bottom: 0; }
      .authpage .a-link { color: var(--accent); font-size: 13px; font-weight: 700; text-decoration: none; }
      .authpage .a-link:hover { text-decoration: underline; }
      .authpage .a-alert {
        background: rgba(220,38,38,.07); border: 1px solid rgba(220,38,38,.25);
        color: var(--danger); border-radius: 10px; padding: 11px 14px;
        font-size: 13.5px; margin-bottom: 18px; line-height: 1.5;
        display: flex; align-items: flex-start; gap: 9px;
      }
      .authpage .a-alert svg { width: 16px; height: 16px; flex: none; margin-top: 1px; }
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
      .authpage .a-check { display: flex; align-items: center; gap: 9px; margin-top: 18px; cursor: pointer; user-select: none; }
      .authpage .a-check input { width: 17px; height: 17px; accent-color: var(--accent); cursor: pointer; }
      .authpage .a-check span { font-size: 13.5px; color: var(--ink2); }
      .authpage .a-divider { display: flex; align-items: center; gap: 12px; margin: 22px 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
      .authpage .a-divider::before, .authpage .a-divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }
      .authpage .a-foot { text-align: center; color: var(--muted); font-size: 13.5px; }
      .authpage .a-foot a { color: var(--accent); font-weight: 700; text-decoration: none; }
      .authpage .a-foot a:hover { text-decoration: underline; }
      .authpage .a-legal { text-align: center; margin: 22px auto 0; color: var(--muted); font-size: 12px; max-width: 340px; line-height: 1.6; }
      .authpage .a-legal a { color: var(--ink2); }
      .authpage .a-trust { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 22px; font-size: 12.5px; color: var(--muted); }
      .authpage .a-trust svg { width: 13px; height: 13px; flex: none; }
      .authpage .a-pwreqs { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
      .authpage .a-req { display: flex; align-items: center; gap: 7px; font-size: 12.5px; }
      .authpage .a-req svg { width: 13px; height: 13px; flex: none; }
      .authpage .a-req.met { color: var(--green); }
      .authpage .a-req.unmet { color: var(--muted); }
      .authpage .a-success { text-align: center; }
      .authpage .a-success .a-sicon {
        width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 16px; display: grid; place-items: center;
        background: var(--greend, rgba(11,158,88,.1)); color: var(--green);
      }
      .authpage .a-success .a-sicon svg { width: 26px; height: 26px; }
      .authpage .a-success h2 { font-size: 17px; font-weight: 800; color: var(--ink); margin-bottom: 8px; }
      .authpage .a-success p { font-size: 13.5px; color: var(--ink2); line-height: 1.6; margin-bottom: 6px; }
      .authpage .a-success .a-muted2 { font-size: 12.5px; color: var(--muted); margin-bottom: 18px; }

      @media (max-width: 980px) {
        .authpage { grid-template-columns: 1fr; }
        .authpage .a-panel { display: none; }
        .authpage .a-right { padding: 40px 16px; }
      }
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
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@500;700&display=swap"
        rel="stylesheet"
      />
    </>
  );
}

/**
 * The left brand panel — identical across login/signup/forgot/reset by
 * design, the way a split-screen auth layout usually works: one fixed brand
 * moment, a different form next to it each time. Hidden below 980px (see
 * AuthStyles) rather than squeezed, so the form always gets full width on
 * tablet and phone instead of being fought for space with copy nobody reads
 * on the way to signing in.
 */
export function AuthPanel() {
  return (
    <div className="a-panel">
      <div className="a-brandrow">
        <img src="/icon/web/icon-512.png" alt="" />
        <span className="a-word">INBOX</span>
        <span className="a-pill">Console</span>
        <span className="a-sub">by Arham Workspace</span>
      </div>

      <h1>Run your company&apos;s email<br /><span className="a-grad">from one console.</span></h1>
      <p className="a-lede">Domains, mailboxes, migrations and billing — set up in minutes, on servers that never leave India.</p>

      <div className="a-feats">
        <div className="a-feat">
          <span className="a-num">01</span>
          <div><strong>Domain management</strong><span>DKIM · SPF · DMARC, written for you</span></div>
        </div>
        <div className="a-feat">
          <span className="a-num">02</span>
          <div><strong>Team mailboxes</strong><span>Create, quota and manage in one place</span></div>
        </div>
        <div className="a-feat">
          <span className="a-num">03</span>
          <div><strong>Free migration</strong><span>Zoho, Google Workspace, cPanel, IMAP</span></div>
        </div>
      </div>

      <div className="a-stats">
        <div className="a-stat"><b>AWS Mumbai</b><span>India-hosted</span></div>
        <div className="a-stat"><b>IMAP · JMAP</b><span>Open standards</span></div>
        <div className="a-stat"><b>1 month</b><span>Free, 10 mailboxes</span></div>
      </div>

      <div className="a-panelfoot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
        India-hosted · Sovereign cloud
      </div>
    </div>
  );
}

export function BackToHome() {
  return (
    <a href="/" className="a-back" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, color: 'var(--muted)', marginBottom: 24, textDecoration: 'none' }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Back to INBOX
    </a>
  );
}
