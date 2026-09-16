/**
 * Visual language for the Email Users page, matching the marketing landing
 * page and the auth pages (public/landing.html, ../auth-theme.tsx) rather
 * than the dashboard's plain inline-style system used elsewhere in this app.
 *
 * u- prefixed classes, not globals.css's .card/.field/.label/.inp/.btn:
 * those are unscoped and already used by every other dashboard page with a
 * different accent (--accent: #2563eb there vs #2F56FF here) — reusing the
 * names would mean out-specificity-ing every property those rules set,
 * forever. A plain <style> tag rendered from this client page is valid HTML
 * and, in practice, scoped to this route: Next.js removes it along with the
 * rest of the component tree on navigation.
 */
export function UsersStyles() {
  return (
    <style>{`
      .userspage {
        --u-accent: #0866F5;
        --u-accent-hover: #0756D8;
        --u-accent-soft: #EEF5FF;
        --u-ink: #0B1739;
        --u-ink2: #607392;
        --u-muted: #94A3B8;
        --u-border: #E2EAF5;
        --u-surface: #FFFFFF;
        --u-surface2: #EEF5FF;
        --u-green: #10B981;
        --u-amber: #F5A800;
        --u-red: #EF4444;
        --u-shadow-s: 0 1px 3px rgba(11, 23, 57, 0.05), 0 1px 2px rgba(11, 23, 57, 0.03);
        --u-shadow-m: 0 4px 20px rgba(11, 23, 57, 0.07), 0 2px 8px rgba(11, 23, 57, 0.04);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .userspage code, .userspage .u-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

      /* header */
      .userspage .u-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }
      .userspage .u-h1row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .userspage h1 { font-size: 24px; font-weight: 800; color: var(--u-ink); letter-spacing: -.02em; }
      .userspage .u-count {
        display: inline-flex; align-items: center; gap: 6px;
        font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 700;
        color: var(--u-accent); background: var(--u-accent-soft); border: 1px solid rgba(47,86,255,.2);
        padding: 4px 10px; border-radius: 999px;
      }
      .userspage .u-count::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--u-accent); }
      .userspage .u-sub { color: var(--u-muted); font-size: 13.5px; margin-top: 4px; }
      .userspage .u-sub a { color: var(--u-accent); font-weight: 600; }
      .userspage .u-headbtns { display: flex; gap: 10px; flex-wrap: wrap; }

      .userspage .u-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 16px; border-radius: 9px; font-weight: 700; font-size: 13.5px;
        border: 1px solid transparent; cursor: pointer; font-family: inherit; white-space: nowrap;
        transition: transform .1s ease, box-shadow .15s ease, background .15s ease;
      }
      .userspage .u-btn svg { width: 14px; height: 14px; flex: none; }
      .userspage .u-btn-primary { background: var(--u-accent); color: #fff; box-shadow: var(--u-shadow-s); }
      .userspage .u-btn-primary:hover:not(:disabled) { box-shadow: var(--u-shadow-m); transform: translateY(-1px); }
      .userspage .u-btn-primary:disabled { opacity: .6; cursor: not-allowed; transform: none; }
      .userspage .u-btn-ghost { background: var(--u-surface); color: var(--u-ink2); border-color: var(--u-border); }
      .userspage .u-btn-ghost:hover { background: var(--u-surface2); }
      .userspage .u-btn-danger { background: #FBE6E5; color: var(--u-red); }
      .userspage .u-btn-danger:hover { background: #F7D2D0; }
      .userspage .u-btn-sm { padding: 6px 10px; font-size: 12px; border-radius: 7px; }
      .userspage .u-iconbtn {
        width: 30px; height: 30px; border-radius: 7px; display: grid; place-items: center;
        background: var(--u-surface); border: 1px solid var(--u-border); color: var(--u-muted); cursor: pointer;
      }
      .userspage .u-iconbtn:hover { background: #FBE6E5; color: var(--u-red); border-color: #f3c6c4; }
      .userspage .u-iconbtn svg { width: 14px; height: 14px; }

      /* stat strip */
      .userspage .u-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 22px; }
      .userspage .u-stat { background: var(--u-surface); border: 1px solid var(--u-border); border-radius: 14px; padding: 16px 18px; box-shadow: var(--u-shadow-s); }
      .userspage .u-stat .u-slabel { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--u-muted); margin-bottom: 6px; }
      .userspage .u-stat .u-sval { font-size: 21px; font-weight: 800; color: var(--u-ink); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
      .userspage .u-stat .u-sval span { font-size: 12.5px; font-weight: 600; color: var(--u-muted); margin-left: 3px; }
      .userspage .u-stat .u-sbar { height: 5px; border-radius: 99px; background: var(--u-surface2); margin-top: 9px; overflow: hidden; }
      .userspage .u-stat .u-sbar i { display: block; height: 100%; background: var(--u-accent); border-radius: 99px; }

      /* search */
      .userspage .u-searchrow { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
      .userspage .u-search {
        flex: 1; display: flex; align-items: center; gap: 9px; background: var(--u-surface);
        border: 1px solid var(--u-border); border-radius: 10px; padding: 10px 14px; box-shadow: var(--u-shadow-s);
      }
      .userspage .u-search svg { width: 15px; height: 15px; color: var(--u-muted); flex: none; }
      .userspage .u-search input { flex: 1; border: 0; outline: 0; background: transparent; font-size: 14px; color: var(--u-ink); font-family: inherit; }
      .userspage .u-search input::placeholder { color: var(--u-muted); }

      /* domain group / table */
      .userspage .u-group { background: var(--u-surface); border: 1px solid var(--u-border); border-radius: 16px; box-shadow: var(--u-shadow-s); overflow: hidden; margin-bottom: 18px; }
      .userspage .u-grouphead { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 14px 20px; background: var(--u-surface2); border-bottom: 1px solid var(--u-border); }
      .userspage .u-grouphead .u-domain { font-weight: 800; color: var(--u-ink); font-size: 14.5px; }
      .userspage .u-grouphead .u-domain b { font-weight: 800; }
      .userspage .u-grouphead .u-groupmeta { font-size: 12.5px; color: var(--u-muted); }

      .userspage .u-thead { display: grid; grid-template-columns: 1fr 220px 168px; gap: 12px; padding: 10px 20px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--u-muted); border-bottom: 1px solid var(--u-border); }
      .userspage .u-row { display: grid; grid-template-columns: 1fr 220px 168px; gap: 12px; align-items: center; padding: 13px 20px; border-bottom: 1px solid #EEF2FA; }
      .userspage .u-row:last-child { border-bottom: none; }
      .userspage .u-who { display: flex; align-items: center; gap: 11px; min-width: 0; }
      .userspage .u-avatar {
        width: 34px; height: 34px; border-radius: 50%; flex: none; display: grid; place-items: center;
        font-size: 12px; font-weight: 700; color: #fff;
      }
      .userspage .u-who .u-addr { font-weight: 700; color: var(--u-ink); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .userspage .u-who .u-desc { font-size: 12px; color: var(--u-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .userspage .u-usage-num { font-size: 12.5px; color: var(--u-ink2); font-variant-numeric: tabular-nums; margin-bottom: 4px; }
      .userspage .u-usage-num b { color: var(--u-ink); font-weight: 700; }
      .userspage .u-usage-num .u-of { color: var(--u-muted); }
      .userspage .u-usage-bar { height: 5px; border-radius: 99px; background: var(--u-surface2); overflow: hidden; }
      .userspage .u-usage-bar i { display: block; height: 100%; border-radius: 99px; }
      .userspage .u-nodata { color: var(--u-muted); font-size: 13px; }
      .userspage .u-actions { display: flex; gap: 7px; justify-content: flex-end; }
      .userspage .u-empty { padding: 32px 20px; text-align: center; color: var(--u-muted); font-size: 13.5px; }

      /* create-user card */
      .userspage .u-card { background: var(--u-surface); border: 1px solid var(--u-border); border-radius: 16px; box-shadow: var(--u-shadow-m); padding: 24px; margin-bottom: 20px; }
      .userspage .u-card h2 { font-size: 16px; font-weight: 800; color: var(--u-ink); margin-bottom: 18px; }
      .userspage .u-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 4px; }
      .userspage .u-field { margin-bottom: 14px; }
      .userspage .u-label { display: block; font-size: 11.5px; font-weight: 700; color: var(--u-ink2); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 7px; }
      .userspage .u-input, .userspage select.u-input {
        width: 100%; padding: 10px 13px; background: var(--u-surface2); border: 1px solid var(--u-border);
        border-radius: 9px; color: var(--u-ink); font-size: 14px; font-family: inherit; outline: none;
        transition: border-color .15s ease, background .15s ease;
      }
      .userspage .u-input:focus { border-color: var(--u-accent); background: var(--u-surface); }
      .userspage .u-preview { font-size: 13px; color: var(--u-muted); margin-bottom: 16px; }
      .userspage .u-preview b { color: var(--u-accent); font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 700; }

      /* alerts */
      .userspage .u-alert { display: flex; align-items: flex-start; gap: 9px; border-radius: 10px; padding: 11px 14px; font-size: 13.5px; margin-bottom: 16px; line-height: 1.5; }
      .userspage .u-alert svg { width: 16px; height: 16px; flex: none; margin-top: 1px; }
      .userspage .u-alert-ok { background: #E0F2EA; color: var(--u-green); border: 1px solid #BFE5D2; }
      .userspage .u-alert-err { background: #FBE6E5; color: var(--u-red); border: 1px solid #F3C6C4; }

      /* modal */
      .userspage .u-modalbg { position: fixed; inset: 0; background: rgba(10,18,40,.55); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
      .userspage .u-modal { background: var(--u-surface); border-radius: 16px; box-shadow: var(--u-shadow-m); padding: 26px; width: 100%; max-width: 400px; }
      .userspage .u-modal h3 { font-size: 17px; font-weight: 800; color: var(--u-ink); margin-bottom: 4px; }
      .userspage .u-modal .u-modalsub { font-size: 13px; color: var(--u-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; margin-bottom: 18px; }

      @media (max-width: 760px) {
        .userspage .u-thead { display: none; }
        .userspage .u-row { grid-template-columns: 1fr; gap: 10px; }
        .userspage .u-actions { justify-content: flex-start; }
        .userspage .u-grid2 { grid-template-columns: 1fr; }
      }
    `}</style>
  );
}

const AVATAR_PALETTE = ['#2F56FF', '#7C3AED', '#0B9E58', '#B45309', '#DB2777', '#0891B2'];

/** Deterministic per-mailbox avatar color, so the same address always gets the same one. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes('@') ? nameOrEmail.split('@')[0] : nameOrEmail;
  const parts = base.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
