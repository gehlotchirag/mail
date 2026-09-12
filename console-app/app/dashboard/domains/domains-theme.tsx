/**
 * Visual language for the Domains list + detail pages — same tokens as
 * app/dashboard/overview-theme.tsx (Plus Jakarta Sans, #2F56FF accent,
 * JetBrains Mono for ids/hosts, card/shadow scale) so the dashboard reads as
 * one product rather than a per-page reskin. d- prefixed classes for the same
 * reason overview-theme.tsx uses o- : reusing globals.css's unscoped
 * .card/.btn would mean out-specificity-ing every property those rules set.
 */
export function DomainsStyles() {
  return (
    <style>{`
      .domainspage {
        --d-accent: #2F56FF;
        --d-accent-soft: rgba(47,86,255,.08);
        --d-ink: #0A1228;
        --d-ink2: #374264;
        --d-muted: #7A8CAE;
        --d-border: #dbeafe;
        --d-surface: #ffffff;
        --d-surface2: #F0F4FF;
        --d-green: #0B9E58;
        --d-green-soft: #E0F2EA;
        --d-amber: #B45309;
        --d-amber-soft: #FBEEDB;
        --d-red: #B0231F;
        --d-red-soft: #FBE6E5;
        --d-shadow-s: 0 1px 3px rgba(10,18,40,.06), 0 1px 2px rgba(10,18,40,.04);
        --d-shadow-m: 0 4px 20px rgba(10,18,40,.08), 0 2px 8px rgba(10,18,40,.05);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .domainspage .d-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

      /* header + breadcrumb */
      .domainspage .d-crumb { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--d-muted); font-weight: 600; margin-bottom: 6px; }
      .domainspage .d-crumb b { color: var(--d-ink); font-weight: 700; }
      .domainspage .d-crumb svg { width: 12px; height: 12px; flex: none; }
      .domainspage .d-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
      .domainspage .d-h1 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .domainspage .d-h1 span:first-child { font-size: 22px; font-weight: 800; color: var(--d-ink); letter-spacing: -.02em; }
      .domainspage .d-count { font-size: 12px; font-weight: 700; color: var(--d-accent); background: var(--d-accent-soft); padding: 3px 10px; border-radius: 999px; }
      .domainspage .d-headactions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

      .domainspage .d-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 16px; border-radius: 9px; font-weight: 700; font-size: 13.5px;
        border: 1px solid var(--d-border); background: var(--d-surface); color: var(--d-ink2);
        cursor: pointer; text-decoration: none; white-space: nowrap;
        transition: background .15s ease, box-shadow .15s ease;
      }
      .domainspage .d-btn svg { width: 15px; height: 15px; flex: none; }
      .domainspage .d-btn:hover { background: var(--d-surface2); }
      .domainspage .d-btn-primary { background: var(--d-accent); color: #fff; border-color: transparent; box-shadow: var(--d-shadow-s); }
      .domainspage .d-btn-primary:hover { box-shadow: var(--d-shadow-m); }
      .domainspage .d-btn-danger { background: var(--d-red); color: #fff; border-color: transparent; }
      .domainspage .d-btn:disabled { opacity: .55; cursor: not-allowed; }

      /* alert banner */
      .domainspage .d-alert {
        display: flex; align-items: center; gap: 14px; background: var(--d-surface);
        border: 1px solid var(--d-border); border-left: 3px solid var(--d-red);
        border-radius: 12px; padding: 15px 18px; box-shadow: var(--d-shadow-s); flex-wrap: wrap; margin-bottom: 4px;
      }
      .domainspage .d-alert-icon { width: 38px; height: 38px; border-radius: 10px; flex: none; display: grid; place-items: center; background: var(--d-red-soft); color: var(--d-red); }
      .domainspage .d-alert-icon svg { width: 18px; height: 18px; }
      .domainspage .d-alert-body { flex: 1; min-width: 200px; }
      .domainspage .d-alert-title { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; font-size: 14.5px; font-weight: 700; color: var(--d-ink); margin-bottom: 3px; }
      .domainspage .d-alert-chip { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 600; color: var(--d-ink2); background: var(--d-surface2); padding: 2px 8px; border-radius: 6px; }
      .domainspage .d-alert-desc { font-size: 13px; color: var(--d-muted); }
      .domainspage .d-alert-cta { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; background: var(--d-red); color: #fff; font-weight: 700; font-size: 13px; text-decoration: none; border: none; cursor: pointer; }
      .domainspage .d-alert-cta svg { width: 13px; height: 13px; }

      /* metrics */
      .domainspage .d-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
      .domainspage .d-metric { background: var(--d-surface); border: 1px solid var(--d-border); border-radius: 14px; padding: 16px 18px; box-shadow: var(--d-shadow-s); }
      .domainspage .d-metric-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--d-muted); }
      .domainspage .d-metric-val { font-size: 24px; font-weight: 800; color: var(--d-ink); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
      .domainspage .d-metric-val.warn { color: var(--d-red); }
      .domainspage .d-metric-sub { font-size: 12px; color: var(--d-muted); font-weight: 600; margin-top: 4px; }
      .domainspage .d-metric-tag { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: var(--d-accent-soft); color: var(--d-accent); }
      .domainspage .d-metric-tag.warn { background: var(--d-red-soft); color: var(--d-red); }

      /* filters + search */
      .domainspage .d-filterbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; background: var(--d-surface); border: 1px solid var(--d-border); border-radius: 12px; padding: 6px; box-shadow: var(--d-shadow-s); }
      .domainspage .d-tabs { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
      .domainspage .d-tab { padding: 7px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: var(--d-muted); background: transparent; border: none; cursor: pointer; white-space: nowrap; }
      .domainspage .d-tab.active { background: var(--d-surface2); color: var(--d-accent); }
      .domainspage .d-search { position: relative; }
      .domainspage .d-search input {
        padding: 8px 12px 8px 32px; border-radius: 8px; border: 1px solid var(--d-border); background: var(--d-surface2);
        font-size: 13px; color: var(--d-ink2); outline: none; width: 220px;
      }
      .domainspage .d-search svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--d-muted); }

      /* domain table */
      .domainspage .d-group { background: var(--d-surface); border: 1px solid var(--d-border); border-radius: 16px; box-shadow: var(--d-shadow-s); overflow: hidden; }
      .domainspage .d-thead { display: grid; grid-template-columns: 1.7fr 100px 1.3fr 1.1fr 1.1fr 90px 100px; gap: 12px; padding: 10px 20px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--d-muted); border-bottom: 1px solid var(--d-border); }
      .domainspage .d-row { display: grid; grid-template-columns: 1.7fr 100px 1.3fr 1.1fr 1.1fr 90px 100px; gap: 12px; align-items: center; padding: 14px 20px; border-bottom: 1px solid #EEF2FA; }
      .domainspage .d-row:last-child { border-bottom: none; }
      .domainspage .d-row.attn { background: var(--d-red-soft); }
      .domainspage .d-domain-cell { min-width: 0; display: flex; align-items: center; gap: 10px; }
      .domainspage .d-favicon { width: 30px; height: 30px; border-radius: 8px; flex: none; display: grid; place-items: center; font-size: 11px; font-weight: 800; background: var(--d-accent-soft); color: var(--d-accent); font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .domainspage .d-favicon.attn { background: var(--d-red-soft); color: var(--d-red); }
      .domainspage .d-domain-name { font-weight: 700; color: var(--d-ink); font-size: 14px; font-family: 'JetBrains Mono', ui-monospace, monospace; }
      .domainspage .d-domain-meta { font-size: 11.5px; color: var(--d-muted); margin-top: 2px; }
      .domainspage .d-domain-meta.attn { color: var(--d-red); font-weight: 600; }
      .domainspage .d-tag { font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 5px; background: var(--d-surface2); color: var(--d-ink2); text-transform: uppercase; }
      .domainspage .d-cell-ok { display: inline-flex; align-items: center; gap: 5px; color: var(--d-green); font-size: 13px; font-weight: 600; }
      .domainspage .d-cell-ok svg { width: 14px; height: 14px; }
      .domainspage .d-cell-warn { display: inline-flex; align-items: center; gap: 5px; color: var(--d-amber); font-size: 13px; font-weight: 600; }
      .domainspage .d-cell-warn svg { width: 14px; height: 14px; }
      .domainspage .d-cell-muted { color: var(--d-muted); font-size: 13px; }
      .domainspage .d-pill { font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px; width: fit-content; }
      .domainspage .d-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .domainspage .d-pill.ok { background: var(--d-green-soft); color: var(--d-green); }
      .domainspage .d-pill.warn { background: var(--d-red-soft); color: var(--d-red); }
      .domainspage .d-pill.neutral { background: var(--d-surface2); color: var(--d-muted); }
      .domainspage .d-row-link { color: var(--d-accent); font-weight: 700; font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; background: none; border: none; cursor: pointer; }
      .domainspage .d-row-link:hover { text-decoration: underline; }
      .domainspage .d-row-link.warn { color: var(--d-red); }
      .domainspage .d-empty { padding: 48px 20px; text-align: center; color: var(--d-muted); }
      .domainspage .d-empty-icon { font-size: 34px; margin-bottom: 12px; }

      /* add domain inline card */
      .domainspage .d-addcard { background: var(--d-surface); border: 1px solid var(--d-border); border-radius: 14px; padding: 18px 20px; box-shadow: var(--d-shadow-s); }
      .domainspage .d-addrow { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .domainspage .d-inp {
        flex: 1; min-width: 220px; padding: 10px 14px; border-radius: 9px; border: 1px solid var(--d-border);
        background: var(--d-surface2); font-size: 14px; color: var(--d-ink2); outline: none;
      }
      .domainspage .d-hint { font-size: 12px; color: var(--d-muted); margin-top: 10px; }
      .domainspage .d-planinfo { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--d-ink2); background: var(--d-surface2); border-radius: 8px; padding: 8px 12px; margin-top: 10px; }
      .domainspage .d-planinfo b { color: var(--d-ink); }

      /* ── detail page ── */
      .domainspage .d-back { display: inline-flex; align-items: center; gap: 5px; color: var(--d-muted); font-size: 13px; font-weight: 600; text-decoration: none; margin-bottom: 10px; }
      .domainspage .d-detailhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
      .domainspage .d-detailtitle { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .domainspage .d-detailtitle h1 { font-size: 22px; font-weight: 800; color: var(--d-ink); letter-spacing: -.02em; }
      .domainspage .d-detailmeta { font-size: 12px; color: var(--d-muted); font-family: 'JetBrains Mono', ui-monospace, monospace; }

      .domainspage .d-banner { border-radius: 12px; padding: 14px 18px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .domainspage .d-banner.danger { background: var(--d-red-soft); border: 1px solid #F3C6C4; }
      .domainspage .d-banner-title { font-weight: 700; font-size: 14px; color: var(--d-red); }
      .domainspage .d-banner-desc { font-size: 12.5px; color: #7a3630; margin-top: 2px; }

      /* health hero card */
      .domainspage .d-hero { background: var(--d-surface); border: 1px solid var(--d-border); border-radius: 16px; padding: 20px 22px; box-shadow: var(--d-shadow-s); }
      .domainspage .d-hero-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
      .domainspage .d-hero-title { display: flex; align-items: center; gap: 9px; font-size: 16.5px; font-weight: 800; color: var(--d-ink); margin-bottom: 4px; }
      .domainspage .d-hero-title svg { width: 22px; height: 22px; flex: none; }
      .domainspage .d-hero-title.ok svg { color: var(--d-green); }
      .domainspage .d-hero-title.warn svg { color: var(--d-red); }
      .domainspage .d-hero-desc { font-size: 13px; color: var(--d-muted); max-width: 640px; }
      .domainspage .d-matrix { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
      .domainspage .d-mbox { background: var(--d-surface2); border-radius: 12px; padding: 14px 15px; display: flex; flex-direction: column; justify-content: space-between; }
      .domainspage .d-mbox.warn { background: var(--d-red-soft); }
      .domainspage .d-mbox-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .domainspage .d-mbox-label { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--d-muted); }
      .domainspage .d-mbox.warn .d-mbox-label { color: #7a3630; }
      .domainspage .d-mbox-icon svg { width: 17px; height: 17px; }
      .domainspage .d-mbox-title { font-size: 13.5px; font-weight: 800; color: var(--d-ink); }
      .domainspage .d-mbox.warn .d-mbox-title { color: var(--d-red); }
      .domainspage .d-mbox-desc { font-size: 11.5px; color: var(--d-muted); margin-top: 3px; }
      .domainspage .d-mbox.warn .d-mbox-desc { color: #7a3630; }
      .domainspage .d-mbox-foot { margin-top: 10px; font-size: 11px; color: var(--d-muted); font-weight: 600; }
      .domainspage .d-mbox-foot a { color: var(--d-accent); text-decoration: none; font-weight: 700; }
      @media (max-width: 900px) { .domainspage .d-matrix { grid-template-columns: repeat(2, 1fr); } }

      /* migration safeguard card */
      .domainspage .d-safeguard { background: var(--d-surface); border: 1px solid var(--d-border); border-radius: 14px; padding: 18px 20px; box-shadow: var(--d-shadow-s); }
      .domainspage .d-safeguard-top { display: flex; align-items: flex-start; gap: 10px; }
      .domainspage .d-safeguard-icon { flex: none; }
      .domainspage .d-safeguard-icon svg { width: 20px; height: 20px; }
      .domainspage .d-safeguard-title { font-size: 14px; font-weight: 700; color: var(--d-ink); }
      .domainspage .d-safeguard-desc { font-size: 12.5px; color: var(--d-muted); margin-top: 4px; }
      .domainspage .d-missing-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-top: 12px; }
      .domainspage .d-missing-chip { display: flex; align-items: center; justify-content: space-between; gap: 6px; background: var(--d-surface2); border-radius: 8px; padding: 7px 10px; font-size: 12px; }
      .domainspage .d-missing-chip .d-mono { color: var(--d-red); font-weight: 600; }
      .domainspage .d-missing-badge { font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 5px; background: var(--d-red-soft); color: var(--d-red); }

      /* dns records table */
      .domainspage .d-rectable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .domainspage .d-rectable th { text-align: left; padding: 9px 14px; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--d-muted); background: var(--d-surface2); border-bottom: 1px solid var(--d-border); }
      .domainspage .d-rectable td { padding: 11px 14px; border-bottom: 1px solid #EEF2FA; vertical-align: middle; }
      .domainspage .d-rectable tr:last-child td { border-bottom: none; }
      .domainspage .d-rectype { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; font-weight: 800; padding: 2px 8px; border-radius: 5px; background: var(--d-accent-soft); color: var(--d-accent); }
      .domainspage .d-rechost, .domainspage .d-recval { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; color: var(--d-ink2); word-break: break-all; }
      .domainspage .d-copybtn { padding: 5px 8px; border-radius: 6px; border: 1px solid var(--d-border); background: var(--d-surface); color: var(--d-muted); cursor: pointer; }
      .domainspage .d-copybtn:hover { color: var(--d-accent); border-color: var(--d-accent); }
      .domainspage .d-copybtn.copied { color: var(--d-green); border-color: var(--d-green); }

      /* mailbox utilization table */
      .domainspage .d-mtable { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12.5px; }
      .domainspage .d-mtable th { text-align: left; padding: 9px 14px; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--d-muted); background: var(--d-surface2); border-bottom: 1px solid var(--d-border); white-space: nowrap; }
      .domainspage .d-mtable td { padding: 10px 14px; border-bottom: 1px solid #EEF2FA; vertical-align: middle; overflow: hidden; white-space: nowrap; }
      .domainspage .d-mtable tr:last-child td { border-bottom: none; }
      .domainspage .d-mtable th:nth-child(1), .domainspage .d-mtable td:nth-child(1) { width: 26%; }
      .domainspage .d-mtable th:nth-child(2), .domainspage .d-mtable td:nth-child(2) { width: 26%; }
      .domainspage .d-mname { font-weight: 600; color: var(--d-ink); overflow: hidden; text-overflow: ellipsis; }
      .domainspage .d-mmail { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; color: var(--d-accent); overflow: hidden; text-overflow: ellipsis; }
      .domainspage .d-musagewrap { display: flex; align-items: center; gap: 8px; }
      .domainspage .d-musagebar { flex: 1; height: 5px; border-radius: 99px; background: var(--d-surface2); overflow: hidden; }
      .domainspage .d-musagebar i { display: block; height: 100%; border-radius: 99px; }
      .domainspage .d-musagepct { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; font-weight: 700; width: 32px; text-align: right; flex: none; }

      /* danger zone */
      .domainspage .d-danger { background: var(--d-red-soft); border: 1px solid #F3C6C4; border-radius: 14px; padding: 18px 20px; }
      .domainspage .d-danger-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; color: var(--d-red); margin-bottom: 6px; }
      .domainspage .d-danger-title svg { width: 18px; height: 18px; }
      .domainspage .d-danger-desc { font-size: 12.5px; color: #7a3630; margin-bottom: 12px; }

      @media (max-width: 1080px) {
        .domainspage .d-metrics { grid-template-columns: repeat(2, 1fr); }
      }
      @media (max-width: 760px) {
        .domainspage .d-metrics { grid-template-columns: 1fr; }
        .domainspage .d-thead { display: none; }
        .domainspage .d-row { grid-template-columns: 1fr; gap: 8px; }
      }
    `}</style>
  );
}
