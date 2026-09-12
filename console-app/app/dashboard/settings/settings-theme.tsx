/**
 * Visual language for the Settings page — same tokens as
 * app/dashboard/domains/domains-theme.tsx (Plus Jakarta Sans, #2F56FF accent,
 * JetBrains Mono for ids, card/shadow scale) so the dashboard reads as one
 * product. s- prefixed classes for the same reason the other redesigned
 * pages use their own prefix: reusing globals.css's unscoped .card/.btn
 * would mean out-specificity-ing every property those rules set, and this
 * page was the last one still depending on them.
 */
export function SettingsStyles() {
  return (
    <style>{`
      .settingspage {
        --s-accent: #2F56FF;
        --s-accent-soft: rgba(47,86,255,.08);
        --s-ink: #0A1228;
        --s-ink2: #374264;
        --s-muted: #7A8CAE;
        --s-border: #dbeafe;
        --s-surface: #ffffff;
        --s-surface2: #F0F4FF;
        --s-green: #0B9E58;
        --s-green-soft: #E0F2EA;
        --s-amber: #B45309;
        --s-amber-soft: #FBEEDB;
        --s-red: #B0231F;
        --s-red-soft: #FBE6E5;
        --s-shadow-s: 0 1px 3px rgba(10,18,40,.06), 0 1px 2px rgba(10,18,40,.04);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .settingspage .s-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

      .settingspage .s-head { margin-bottom: 1.5rem; }
      .settingspage .s-head h1 { font-size: 1.4rem; font-weight: 800; color: var(--s-ink); letter-spacing: -.02em; }
      .settingspage .s-head p { color: var(--s-muted); margin-top: .25rem; font-size: .875rem; }

      .settingspage .s-card { background: var(--s-surface); border: 1px solid var(--s-border); border-radius: 14px; padding: 1.5rem; box-shadow: var(--s-shadow-s); margin-bottom: 1.25rem; }
      .settingspage .s-cardhead { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; margin-bottom: 1.1rem; }
      .settingspage .s-cardtitle { font-size: 1rem; font-weight: 800; color: var(--s-ink); }

      .settingspage .s-field { margin-bottom: 1rem; }
      .settingspage .s-labelrow { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .3rem; }
      .settingspage .s-label { font-size: .78rem; font-weight: 700; color: var(--s-ink2); }
      .settingspage .s-counter { font-size: .72rem; color: var(--s-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .settingspage .s-inp { width: 100%; padding: .7rem .9rem; background: var(--s-surface2); border: 1px solid var(--s-border); border-radius: 9px; color: var(--s-ink2); outline: none; box-sizing: border-box; font-size: .9rem; }
      .settingspage .s-inp:disabled { color: var(--s-muted); cursor: not-allowed; }
      .settingspage .s-hint { font-size: .75rem; color: var(--s-muted); margin-top: .35rem; }

      .settingspage .s-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: .65rem 1.3rem; border-radius: 9px; font-weight: 700; font-size: .82rem; border: 1px solid var(--s-border); background: var(--s-surface); color: var(--s-ink2); cursor: pointer; transition: background .15s, box-shadow .15s; }
      .settingspage .s-btn:hover { background: var(--s-surface2); }
      .settingspage .s-btn:disabled { opacity: .5; cursor: not-allowed; }
      .settingspage .s-btn-primary { background: var(--s-accent); color: #fff; border-color: transparent; box-shadow: var(--s-shadow-s); }
      .settingspage .s-btn-primary:hover { box-shadow: 0 4px 20px rgba(10,18,40,.08); }
      .settingspage .s-btn-primary:disabled { background: var(--s-surface2); color: var(--s-muted); box-shadow: none; }
      .settingspage .s-btn-danger { background: var(--s-red); color: #fff; border-color: transparent; }
      .settingspage .s-btn-danger:disabled { background: var(--s-surface2); color: var(--s-muted); }

      .settingspage .s-alert { padding: .7rem 1rem; border-radius: 9px; font-size: .85rem; margin-bottom: 1rem; font-weight: 600; }
      .settingspage .s-alert-success { background: var(--s-green-soft); color: var(--s-green); border: 1px solid #BFE5D2; }
      .settingspage .s-alert-error { background: var(--s-red-soft); color: var(--s-red); border: 1px solid #F3C6C4; }

      .settingspage .s-savedbadge { display: inline-flex; align-items: center; gap: 6px; font-size: .78rem; font-weight: 700; color: var(--s-green); background: var(--s-green-soft); padding: 4px 10px; border-radius: 999px; }
      .settingspage .s-savedbadge .s-mono { color: var(--s-muted); font-weight: 500; }

      /* password strength */
      .settingspage .s-pwgrid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1.5rem; align-items: start; }
      @media (max-width: 760px) { .settingspage .s-pwgrid { grid-template-columns: 1fr; } }
      .settingspage .s-strengthcard { background: var(--s-surface2); border-radius: 12px; padding: 1rem 1.1rem; }
      .settingspage .s-strengthtop { display: flex; align-items: center; justify-content: space-between; margin-bottom: .6rem; }
      .settingspage .s-strengthbars { display: flex; gap: 4px; margin-bottom: .9rem; }
      .settingspage .s-strengthbars i { flex: 1; height: 6px; border-radius: 99px; background: var(--s-border); display: block; }
      .settingspage .s-reqlabel { font-size: .68rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--s-muted); margin-bottom: .5rem; display: block; }
      .settingspage .s-req { display: flex; align-items: center; gap: 7px; font-size: .8rem; color: var(--s-muted); margin-bottom: .4rem; }
      .settingspage .s-req.ok { color: var(--s-ink2); font-weight: 600; }
      .settingspage .s-req .s-dot { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--s-border); flex: none; display: grid; place-items: center; font-size: 9px; }
      .settingspage .s-req.ok .s-dot { border-color: var(--s-accent); background: var(--s-accent); color: #fff; }

      .settingspage .s-notice { background: var(--s-surface2); border-radius: 10px; padding: .8rem 1rem; font-size: .8rem; color: var(--s-ink2); line-height: 1.5; display: flex; gap: 9px; align-items: flex-start; }

      /* danger zone */
      .settingspage .s-danger { background: var(--s-red-soft); border: 1px solid #F3C6C4; border-radius: 14px; padding: 1.5rem; }
      .settingspage .s-danger h2 { font-size: 1rem; font-weight: 800; color: var(--s-red); margin-bottom: .4rem; }
      .settingspage .s-danger p { color: #7a3630; font-size: .85rem; margin-bottom: .6rem; line-height: 1.5; }
      .settingspage .s-danger-meta { font-size: .78rem; color: var(--s-red); font-weight: 600; font-family: 'JetBrains Mono', ui-monospace, monospace; margin-bottom: 1rem; }

      /* delete modal */
      .settingspage .s-modal-overlay { position: fixed; inset: 0; background: rgba(10,18,40,.5); display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 60; }
      .settingspage .s-modal { background: var(--s-surface); border-radius: 16px; padding: 1.75rem; max-width: 460px; width: 100%; box-shadow: 0 24px 64px rgba(10,18,40,.25); }
      .settingspage .s-modal h2 { font-size: 1.1rem; font-weight: 800; color: var(--s-ink); margin-bottom: .6rem; }
      .settingspage .s-modal p { color: var(--s-ink2); font-size: .85rem; line-height: 1.5; margin-bottom: 1rem; }
    `}</style>
  );
}
