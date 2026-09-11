/**
 * Visual language for the dashboard Overview page — matching the landing
 * page / auth pages / Email Users page (Plus Jakarta Sans, #2F56FF,
 * card/table/shadow scale) rather than globals.css's dashboard system,
 * which a different accent (--accent: #2563eb) and is still used by the
 * other dashboard pages (Domains, Billing, Settings) this pass doesn't
 * touch. o- prefixed classes for the same reason auth-theme.tsx and
 * users-theme.tsx use a-/u- : reusing globals.css's unscoped .card/.btn
 * would mean out-specificity-ing every property those rules set, forever.
 */
export function OverviewStyles() {
  return (
    <style>{`
      .overviewpage {
        --o-accent: #2F56FF;
        --o-accent-soft: rgba(47,86,255,.08);
        --o-ink: #0A1228;
        --o-ink2: #374264;
        --o-muted: #7A8CAE;
        --o-border: #dbeafe;
        --o-surface: #ffffff;
        --o-surface2: #F0F4FF;
        --o-green: #0B9E58;
        --o-green-soft: #E0F2EA;
        --o-amber: #B45309;
        --o-amber-soft: #FBEEDB;
        --o-red: #B0231F;
        --o-red-soft: #FBE6E5;
        --o-shadow-s: 0 1px 3px rgba(10,18,40,.06), 0 1px 2px rgba(10,18,40,.04);
        --o-shadow-m: 0 4px 20px rgba(10,18,40,.08), 0 2px 8px rgba(10,18,40,.05);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .overviewpage .o-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

      /* header */
      .overviewpage .o-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 26px; }
      .overviewpage .o-h1 { font-size: 24px; font-weight: 800; color: var(--o-ink); letter-spacing: -.02em; margin-bottom: 5px; }
      .overviewpage .o-sub { color: var(--o-muted); font-size: 14px; }
      .overviewpage .o-who { display: flex; align-items: center; gap: 11px; }
      .overviewpage .o-who-text { text-align: right; }
      .overviewpage .o-who-name { font-size: 13.5px; font-weight: 700; color: var(--o-ink); }
      .overviewpage .o-who-email { font-size: 12px; color: var(--o-muted); }
      .overviewpage .o-avatar {
        width: 36px; height: 36px; border-radius: 50%; background: var(--o-accent); color: #fff;
        display: grid; place-items: center; font-size: 13px; font-weight: 700; flex: none;
      }

      /* greeting row */
      .overviewpage .o-greetrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 26px; }
      .overviewpage .o-greet { font-size: 21px; font-weight: 800; color: var(--o-ink); letter-spacing: -.02em; margin-bottom: 5px; }
      .overviewpage .o-greetsub { color: var(--o-muted); font-size: 14px; }
      .overviewpage .o-greetactions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .overviewpage .o-healthpill {
        display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700;
        padding: 7px 13px; border-radius: 999px;
      }
      .overviewpage .o-healthpill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
      .overviewpage .o-healthpill.ok { background: var(--o-green-soft); color: var(--o-green); }
      .overviewpage .o-healthpill.warn { background: var(--o-amber-soft); color: var(--o-amber); }
      .overviewpage .o-healthpill.neutral { background: var(--o-surface2); color: var(--o-muted); }

      .overviewpage .o-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 16px; border-radius: 9px; font-weight: 700; font-size: 13.5px;
        border: 1px solid var(--o-border); background: var(--o-surface); color: var(--o-ink2);
        cursor: pointer; text-decoration: none; white-space: nowrap;
        transition: background .15s ease, box-shadow .15s ease;
      }
      .overviewpage .o-btn svg { width: 14px; height: 14px; flex: none; }
      .overviewpage .o-btn:hover { background: var(--o-surface2); }
      .overviewpage .o-btn-primary { background: var(--o-accent); color: #fff; border-color: transparent; box-shadow: var(--o-shadow-s); }
      .overviewpage .o-btn-primary:hover { box-shadow: var(--o-shadow-m); }

      /* needs attention */
      .overviewpage .o-section-label {
        display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .overviewpage .o-section-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--o-ink); }
      .overviewpage .o-section-title .o-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--o-amber); }
      .overviewpage .o-section-title.ok .o-dot { background: var(--o-green); }
      .overviewpage .o-badge-count { font-size: 11.5px; font-weight: 700; color: var(--o-amber); background: var(--o-amber-soft); padding: 4px 10px; border-radius: 999px; }

      .overviewpage .o-attn { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
      .overviewpage .o-attn-card {
        display: flex; align-items: center; gap: 14px; background: var(--o-surface);
        border: 1px solid var(--o-border); border-left: 3px solid var(--o-amber);
        border-radius: 12px; padding: 15px 18px; box-shadow: var(--o-shadow-s); flex-wrap: wrap;
      }
      .overviewpage .o-attn-card.info { border-left-color: var(--o-accent); }
      .overviewpage .o-attn-icon {
        width: 38px; height: 38px; border-radius: 10px; flex: none; display: grid; place-items: center;
        background: var(--o-amber-soft); color: var(--o-amber);
      }
      .overviewpage .o-attn-card.info .o-attn-icon { background: var(--o-accent-soft); color: var(--o-accent); }
      .overviewpage .o-attn-icon svg { width: 18px; height: 18px; }
      .overviewpage .o-attn-body { flex: 1; min-width: 200px; }
      .overviewpage .o-attn-title { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; font-size: 14.5px; font-weight: 700; color: var(--o-ink); margin-bottom: 3px; }
      .overviewpage .o-attn-chip { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 600; color: var(--o-ink2); background: var(--o-surface2); padding: 2px 8px; border-radius: 6px; }
      .overviewpage .o-attn-desc { font-size: 13px; color: var(--o-muted); }
      .overviewpage .o-attn-cta {
        flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px;
        border-radius: 8px; background: var(--o-amber); color: #fff; font-weight: 700; font-size: 13px;
        text-decoration: none;
      }
      .overviewpage .o-attn-card.info .o-attn-cta { background: var(--o-surface); color: var(--o-ink2); border: 1px solid var(--o-border); }
      .overviewpage .o-attn-cta svg { width: 13px; height: 13px; }
      .overviewpage .o-allclear {
        display: flex; align-items: center; gap: 12px; background: var(--o-green-soft);
        border: 1px solid #BFE5D2; border-radius: 12px; padding: 15px 18px; margin-bottom: 28px;
      }
      .overviewpage .o-allclear svg { width: 20px; height: 20px; color: var(--o-green); flex: none; }
      .overviewpage .o-allclear span { font-size: 14px; font-weight: 700; color: var(--o-green); }

      /* stat tiles */
      .overviewpage .o-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
      .overviewpage .o-stat { background: var(--o-surface); border: 1px solid var(--o-border); border-radius: 14px; padding: 18px 20px; box-shadow: var(--o-shadow-s); display: flex; flex-direction: column; }
      .overviewpage .o-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .overviewpage .o-stat-label { font-size: 12.5px; font-weight: 700; color: var(--o-ink2); }
      .overviewpage .o-stat-tag { font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; background: var(--o-accent-soft); color: var(--o-accent); }
      .overviewpage .o-stat-val { font-size: 26px; font-weight: 800; color: var(--o-ink); letter-spacing: -.02em; font-variant-numeric: tabular-nums; margin-bottom: 4px; }
      .overviewpage .o-stat-meta { font-size: 12px; color: var(--o-muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
      .overviewpage .o-stat-meta .warn { color: var(--o-amber); font-weight: 700; }
      .overviewpage .o-stat-meta .ok { color: var(--o-green); font-weight: 700; }
      .overviewpage .o-stat-bar { height: 5px; border-radius: 99px; background: var(--o-surface2); overflow: hidden; margin-bottom: 12px; }
      .overviewpage .o-stat-bar i { display: block; height: 100%; border-radius: 99px; background: var(--o-accent); }
      .overviewpage .o-stat-foot { margin-top: auto; padding-top: 10px; border-top: 1px solid #EEF2FA; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
      .overviewpage .o-stat-foot a { color: var(--o-accent); font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
      .overviewpage .o-stat-foot a:hover { text-decoration: underline; }
      .overviewpage .o-stat-foot a svg { width: 12px; height: 12px; }
      .overviewpage .o-stat-foot span { color: var(--o-muted); }

      /* domain health table */
      .overviewpage .o-group { background: var(--o-surface); border: 1px solid var(--o-border); border-radius: 16px; box-shadow: var(--o-shadow-s); overflow: hidden; }
      .overviewpage .o-grouphead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 18px 20px; border-bottom: 1px solid var(--o-border); }
      .overviewpage .o-grouptitle { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 15.5px; font-weight: 800; color: var(--o-ink); margin-bottom: 4px; }
      .overviewpage .o-grouptitle .o-count { font-size: 12px; font-weight: 700; color: var(--o-muted); background: var(--o-surface2); padding: 2px 9px; border-radius: 999px; }
      .overviewpage .o-groupsub { font-size: 13px; color: var(--o-muted); }
      .overviewpage .o-groupbadges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .overviewpage .o-pill { font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px; }
      .overviewpage .o-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .overviewpage .o-pill.ok { background: var(--o-green-soft); color: var(--o-green); }
      .overviewpage .o-pill.warn { background: var(--o-amber-soft); color: var(--o-amber); }

      .overviewpage .o-thead { display: grid; grid-template-columns: 1.6fr 100px 130px 130px 100px 90px; gap: 12px; padding: 10px 20px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--o-muted); border-bottom: 1px solid var(--o-border); }
      .overviewpage .o-row { display: grid; grid-template-columns: 1.6fr 100px 130px 130px 100px 90px; gap: 12px; align-items: center; padding: 14px 20px; border-bottom: 1px solid #EEF2FA; }
      .overviewpage .o-row:last-child { border-bottom: none; }
      .overviewpage .o-domain-cell { min-width: 0; }
      .overviewpage .o-domain-name { font-weight: 700; color: var(--o-ink); font-size: 14px; font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .overviewpage .o-domain-meta { font-size: 11.5px; color: var(--o-muted); margin-top: 2px; }
      .overviewpage .o-cell-ok { display: inline-flex; align-items: center; gap: 5px; color: var(--o-green); font-size: 13px; font-weight: 600; }
      .overviewpage .o-cell-ok svg { width: 14px; height: 14px; }
      .overviewpage .o-cell-warn { display: inline-flex; align-items: center; gap: 5px; color: var(--o-amber); font-size: 13px; font-weight: 600; }
      .overviewpage .o-cell-warn svg { width: 14px; height: 14px; }
      .overviewpage .o-cell-muted { color: var(--o-muted); font-size: 13px; }
      .overviewpage .o-row-link { color: var(--o-accent); font-weight: 700; font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; }
      .overviewpage .o-row-link:hover { text-decoration: underline; }
      .overviewpage .o-row-link.warn { color: var(--o-amber); }
      .overviewpage .o-empty { padding: 40px 20px; text-align: center; color: var(--o-muted); font-size: 14px; }
      .overviewpage .o-empty a { color: var(--o-accent); font-weight: 700; }

      /* getting-started checklist, empty-workspace state */
      .overviewpage .o-steps { display: flex; flex-direction: column; gap: 1px; }
      .overviewpage .o-step { display: flex; align-items: flex-start; gap: 13px; padding: 15px 20px; border-bottom: 1px solid #EEF2FA; text-decoration: none; }
      .overviewpage .o-step:last-child { border-bottom: none; }
      .overviewpage .o-step-icon { width: 22px; height: 22px; flex: none; margin-top: 1px; }
      .overviewpage .o-step-icon svg { width: 100%; height: 100%; }
      .overviewpage .o-step-title { font-size: 14.5px; font-weight: 700; color: var(--o-ink); margin-bottom: 2px; }
      .overviewpage .o-step-hint { font-size: 12.5px; color: var(--o-muted); }
      .overviewpage .o-step.done .o-step-title { color: var(--o-muted); text-decoration: line-through; font-weight: 600; }

      @media (max-width: 1080px) {
        .overviewpage .o-stats { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 760px) {
        .overviewpage .o-stats { grid-template-columns: 1fr; }
        .overviewpage .o-thead { display: none; }
        .overviewpage .o-row { grid-template-columns: 1fr; gap: 8px; }
      }

      /* two-column workflow grid (mailboxes/migration, deliverability/billing) */
      .overviewpage .o-grid2 { display: grid; grid-template-columns: 7fr 5fr; gap: 20px; margin-top: 20px; align-items: start; }
      @media (max-width: 980px) {
        .overviewpage .o-grid2 { grid-template-columns: 1fr; }
      }

      .overviewpage .o-panel { background: var(--o-surface); border: 1px solid var(--o-border); border-radius: 16px; box-shadow: var(--o-shadow-s); overflow: hidden; display: flex; flex-direction: column; }
      .overviewpage .o-panelhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 16px 18px; border-bottom: 1px solid var(--o-border); flex-wrap: wrap; }
      .overviewpage .o-paneltitle { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14.5px; font-weight: 800; color: var(--o-ink); }
      .overviewpage .o-panelsub { font-size: 12px; color: var(--o-muted); margin-top: 3px; }
      .overviewpage .o-panelfoot { padding: 11px 18px; background: var(--o-surface2); border-top: 1px solid var(--o-border); display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--o-muted); }
      .overviewpage .o-panelfoot a { color: var(--o-accent); font-weight: 700; text-decoration: none; }
      .overviewpage .o-panelfoot a:hover { text-decoration: underline; }

      /* mini mailbox table (mailboxes panel) */
      .overviewpage .o-mtable { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12.5px; }
      .overviewpage .o-mtable thead tr { background: var(--o-surface2); }
      .overviewpage .o-mtable th { text-align: left; padding: 9px 14px; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--o-muted); border-bottom: 1px solid var(--o-border); white-space: nowrap; }
      .overviewpage .o-mtable td { padding: 10px 14px; border-bottom: 1px solid #EEF2FA; vertical-align: middle; overflow: hidden; white-space: nowrap; }
      .overviewpage .o-mtable tr:last-child td { border-bottom: none; }
      .overviewpage .o-mtable th:nth-child(1), .overviewpage .o-mtable td:nth-child(1) { width: 40%; }
      .overviewpage .o-mtable th:nth-child(2), .overviewpage .o-mtable td:nth-child(2) { width: 18%; }
      .overviewpage .o-mtable th:nth-child(3), .overviewpage .o-mtable td:nth-child(3) { width: 22%; white-space: nowrap; }
      .overviewpage .o-mtable th:nth-child(4), .overviewpage .o-mtable td:nth-child(4) { width: 20%; }
      .overviewpage .o-mname { font-weight: 600; color: var(--o-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .overviewpage .o-mmail { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--o-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .overviewpage .o-mdomain { font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--o-ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .overviewpage .o-musagewrap { display: flex; align-items: center; gap: 8px; min-width: 90px; }
      .overviewpage .o-musagebar { flex: 1; height: 5px; border-radius: 99px; background: var(--o-surface2); overflow: hidden; }
      .overviewpage .o-musagebar i { display: block; height: 100%; border-radius: 99px; }
      .overviewpage .o-musagepct { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 700; width: 32px; text-align: right; flex: none; }

      /* migration panel */
      .overviewpage .o-migbody { padding: 16px 18px; }
      .overviewpage .o-migrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
      .overviewpage .o-migsrc-label { font-size: 11px; font-weight: 600; color: var(--o-muted); }
      .overviewpage .o-migsrc { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 700; color: var(--o-ink); margin-top: 2px; }
      .overviewpage .o-migsrc svg { width: 13px; height: 13px; color: var(--o-muted); }
      .overviewpage .o-migprogtitle { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 5px; }
      .overviewpage .o-migprogtitle b { color: var(--o-accent); font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .overviewpage .o-migbar { height: 7px; border-radius: 99px; background: var(--o-surface2); overflow: hidden; margin-bottom: 14px; }
      .overviewpage .o-migbar i { display: block; height: 100%; border-radius: 99px; background: var(--o-accent); }
      .overviewpage .o-migmetrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding-top: 12px; border-top: 1px solid #EEF2FA; text-align: center; }
      .overviewpage .o-migmetric { background: var(--o-surface2); border-radius: 8px; padding: 8px 4px; }
      .overviewpage .o-migmetric b { display: block; font-size: 13px; font-weight: 800; color: var(--o-ink); font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .overviewpage .o-migmetric span { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--o-muted); }
      .overviewpage .o-migempty { padding: 22px 18px; text-align: center; color: var(--o-muted); font-size: 13px; }
      .overviewpage .o-migempty a { color: var(--o-accent); font-weight: 700; }
      .overviewpage .o-livepill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--o-green-soft); color: var(--o-green); }
      .overviewpage .o-livepill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: o-pulse 2s cubic-bezier(.4,0,.6,1) infinite; }
      @keyframes o-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.35); opacity: .55; } }

      .overviewpage .o-recentmig { padding: 0 18px 14px; }
      .overviewpage .o-recentmig-label { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--o-muted); margin-bottom: 6px; }
      .overviewpage .o-recentmig-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 0; border-top: 1px solid #EEF2FA; font-size: 12px; }
      .overviewpage .o-recentmig-row:first-of-type { border-top: none; }
      .overviewpage .o-recentmig-src { font-weight: 600; color: var(--o-ink); }
      .overviewpage .o-recentmig-status { font-weight: 700; }
      .overviewpage .o-recentmig-status.ok { color: var(--o-green); }
      .overviewpage .o-recentmig-status.fail { color: var(--o-red); }
      .overviewpage .o-recentmig-date { color: var(--o-muted); font-size: 11px; }

      /* deliverability / suppressions panel */
      .overviewpage .o-suppr-row { display: grid; grid-template-columns: 1.6fr 1fr .8fr 1fr; gap: 10px; align-items: center; padding: 11px 18px; border-bottom: 1px solid #EEF2FA; font-size: 12.5px; }
      .overviewpage .o-suppr-row:last-child { border-bottom: none; }
      .overviewpage .o-suppr-email { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 600; color: var(--o-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .overviewpage .o-suppr-badge { display: inline-flex; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: var(--o-red-soft); color: var(--o-red); width: fit-content; }
      .overviewpage .o-suppr-count { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 700; color: var(--o-ink2); }
      .overviewpage .o-suppr-time { color: var(--o-muted); font-size: 11.5px; }

      /* billing summary card */
      .overviewpage .o-billrow { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #EEF2FA; font-size: 12.5px; }
      .overviewpage .o-billrow:last-child { border-bottom: none; }
      .overviewpage .o-billrow span:first-child { color: var(--o-muted); }
      .overviewpage .o-billrow span:last-child { font-weight: 700; color: var(--o-ink); }

      /* quick actions grid */
      .overviewpage .o-qa-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 16px 18px; }
      .overviewpage .o-qa { display: block; text-align: left; padding: 12px; border: 1px solid var(--o-border); border-radius: 10px; text-decoration: none; transition: border-color .15s, background .15s; }
      .overviewpage .o-qa:hover { border-color: var(--o-accent); background: var(--o-accent-soft); }
      .overviewpage .o-qa-icon { width: 28px; height: 28px; border-radius: 8px; background: var(--o-accent-soft); color: var(--o-accent); display: grid; place-items: center; margin-bottom: 8px; }
      .overviewpage .o-qa-icon svg { width: 15px; height: 15px; }
      .overviewpage .o-qa-title { font-size: 12.5px; font-weight: 700; color: var(--o-ink); }
      .overviewpage .o-qa-hint { font-size: 10.5px; color: var(--o-muted); margin-top: 2px; }

      @media (max-width: 640px) {
        .overviewpage .o-migmetrics { grid-template-columns: repeat(3, 1fr); }
        .overviewpage .o-suppr-row { grid-template-columns: 1fr; gap: 3px; }
      }
    `}</style>
  );
}
