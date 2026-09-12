/**
 * Visual language for the Billing & Plans page — same tokens as
 * app/dashboard/domains/domains-theme.tsx (Plus Jakarta Sans, #2F56FF accent,
 * JetBrains Mono for prices/ids, card/shadow scale).
 */
export function BillingStyles() {
  return (
    <style>{`
      .billingpage {
        --b-accent: #2F56FF;
        --b-accent-soft: rgba(47,86,255,.08);
        --b-ink: #0A1228;
        --b-ink2: #374264;
        --b-muted: #7A8CAE;
        --b-border: #dbeafe;
        --b-surface: #ffffff;
        --b-surface2: #F0F4FF;
        --b-green: #0B9E58;
        --b-green-soft: #E0F2EA;
        --b-amber: #B45309;
        --b-amber-soft: #FBEEDB;
        --b-red: #B0231F;
        --b-red-soft: #FBE6E5;
        --b-shadow-s: 0 1px 3px rgba(10,18,40,.06), 0 1px 2px rgba(10,18,40,.04);
        --b-shadow-m: 0 4px 20px rgba(10,18,40,.08), 0 2px 8px rgba(10,18,40,.05);
        font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .billingpage .b-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

      .billingpage .b-head { margin-bottom: 1.5rem; }
      .billingpage .b-head h1 { font-size: 1.4rem; font-weight: 800; color: var(--b-ink); letter-spacing: -.02em; }
      .billingpage .b-head p { color: var(--b-muted); margin-top: .25rem; font-size: .875rem; }

      .billingpage .b-alert { padding: .75rem 1rem; border-radius: 9px; font-size: .85rem; margin-bottom: 1rem; font-weight: 600; }
      .billingpage .b-alert-success { background: var(--b-green-soft); color: var(--b-green); border: 1px solid #BFE5D2; }
      .billingpage .b-alert-error { background: var(--b-red-soft); color: var(--b-red); border: 1px solid #F3C6C4; }

      .billingpage .b-failbanner { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; background: var(--b-red-soft); border: 1px solid #F3C6C4; border-radius: 14px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
      .billingpage .b-failbanner-title { font-weight: 800; color: var(--b-red); font-size: .9rem; }
      .billingpage .b-failbanner-desc { color: #7a3630; font-size: .8rem; margin-top: .2rem; }

      .billingpage .b-toprow { display: grid; grid-template-columns: 5fr 7fr; gap: 1.25rem; margin-bottom: 1.25rem; }
      @media (max-width: 900px) { .billingpage .b-toprow { grid-template-columns: 1fr; } }
      .billingpage .b-card { background: var(--b-surface); border: 1px solid var(--b-border); border-radius: 14px; padding: 1.5rem; box-shadow: var(--b-shadow-s); }

      .billingpage .b-eyebrow { font-size: .72rem; font-weight: 700; color: var(--b-muted); text-transform: uppercase; letter-spacing: .05em; }
      .billingpage .b-pill { display: inline-flex; align-items: center; gap: 6px; font-size: .72rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
      .billingpage .b-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .billingpage .b-pill.ok { background: var(--b-green-soft); color: var(--b-green); }
      .billingpage .b-pill.warn { background: var(--b-amber-soft); color: var(--b-amber); }
      .billingpage .b-pill.bad { background: var(--b-red-soft); color: var(--b-red); }
      .billingpage .b-pill.neutral { background: var(--b-surface2); color: var(--b-muted); }

      .billingpage .b-planname { font-size: 1.6rem; font-weight: 800; color: var(--b-ink); letter-spacing: -.02em; margin: .3rem 0; }
      .billingpage .b-substat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; background: var(--b-surface2); border-radius: 10px; padding: .75rem; margin-top: .75rem; }
      .billingpage .b-substat-label { font-size: .72rem; color: var(--b-muted); font-weight: 600; }
      .billingpage .b-substat-val { font-size: 1.05rem; font-weight: 800; color: var(--b-ink); margin-top: 2px; }
      .billingpage .b-substat-sub { font-size: .7rem; color: var(--b-muted); }

      .billingpage .b-cardfoot { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; padding-top: 1rem; margin-top: 1rem; border-top: 1px solid var(--b-border); }

      .billingpage .b-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: .6rem 1.1rem; border-radius: 9px; font-weight: 700; font-size: .8rem; border: 1px solid var(--b-border); background: var(--b-surface); color: var(--b-ink2); cursor: pointer; }
      .billingpage .b-btn:hover { background: var(--b-surface2); }
      .billingpage .b-btn:disabled { opacity: .5; cursor: not-allowed; }
      .billingpage .b-btn-primary { background: var(--b-accent); color: #fff; border-color: transparent; box-shadow: var(--b-shadow-s); }
      .billingpage .b-btn-primary:hover { box-shadow: var(--b-shadow-m); }
      .billingpage .b-btn-primary:disabled { background: var(--b-surface2); color: var(--b-muted); box-shadow: none; }
      .billingpage .b-btn-text { background: none; border: none; color: var(--b-red); font-weight: 700; font-size: .8rem; cursor: pointer; padding: .3rem 0; }

      /* seat gauge */
      .billingpage .b-gaugebar { width: 100%; height: 12px; background: var(--b-surface2); border-radius: 99px; overflow: hidden; margin: .75rem 0 .4rem; }
      .billingpage .b-gaugebar i { display: block; height: 100%; background: var(--b-accent); border-radius: 99px; transition: width .5s ease; }
      .billingpage .b-gaugelabels { display: flex; justify-content: space-between; font-size: .72rem; color: var(--b-muted); }
      .billingpage .b-chip3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; margin-top: 1rem; }
      .billingpage .b-chip { background: var(--b-surface2); border-radius: 10px; padding: .65rem .75rem; }
      .billingpage .b-chip-label { font-size: .7rem; color: var(--b-muted); font-weight: 600; }
      .billingpage .b-chip-val { font-size: 1.05rem; font-weight: 800; color: var(--b-accent); margin-top: 2px; }
      .billingpage .b-chip-sub { font-size: .68rem; color: var(--b-muted); margin-top: 1px; }

      /* seat calculator */
      .billingpage .b-calc-controls { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; background: var(--b-surface2); border-radius: 12px; padding: 1rem; }
      .billingpage .b-stepper { display: flex; align-items: center; background: var(--b-surface); border-radius: 9px; box-shadow: var(--b-shadow-s); }
      .billingpage .b-stepper button { width: 36px; height: 36px; border: none; background: none; font-size: 1.1rem; font-weight: 700; color: var(--b-ink2); cursor: pointer; border-radius: 9px; }
      .billingpage .b-stepper button:hover { background: var(--b-surface2); }
      .billingpage .b-stepper input { width: 90px; text-align: center; border: none; background: none; font-weight: 800; font-size: 1rem; color: var(--b-ink); outline: none; }
      .billingpage .b-presets { display: flex; gap: 6px; flex-wrap: wrap; }
      .billingpage .b-preset { padding: 6px 12px; border-radius: 8px; font-size: .78rem; font-weight: 700; background: var(--b-surface); border: 1px solid var(--b-border); color: var(--b-ink2); cursor: pointer; }
      .billingpage .b-preset.active { background: var(--b-accent); color: #fff; border-color: transparent; }

      /* plan grid */
      .billingpage .b-plangrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1rem; }
      .billingpage .b-plancard { position: relative; background: var(--b-surface); border: 1.5px solid var(--b-border); border-radius: 14px; padding: 1.4rem; box-shadow: var(--b-shadow-s); display: flex; flex-direction: column; }
      .billingpage .b-plancard.current { border-color: var(--b-accent); }
      .billingpage .b-plantag { position: absolute; top: -1px; right: -1px; font-size: .62rem; font-weight: 800; padding: 3px 9px; border-radius: 0 12px 0 8px; text-transform: uppercase; letter-spacing: .05em; color: #fff; }
      .billingpage .b-plantag.current { background: var(--b-accent); }
      .billingpage .b-plantag.popular { background: #7c3aed; }
      .billingpage .b-planlabel { font-weight: 800; color: var(--b-ink2); font-size: .82rem; text-transform: uppercase; letter-spacing: .04em; margin-bottom: .4rem; }
      .billingpage .b-planprice { display: flex; align-items: baseline; gap: 4px; }
      .billingpage .b-planprice b { font-size: 1.55rem; font-weight: 800; color: var(--b-ink); }
      .billingpage .b-planprice span { color: var(--b-muted); font-size: .75rem; }
      .billingpage .b-plantotal { color: var(--b-muted); font-size: .78rem; margin-top: .2rem; font-variant-numeric: tabular-nums; }
      .billingpage .b-plansaving { margin-top: .5rem; display: inline-block; background: var(--b-green-soft); color: var(--b-green); border-radius: 6px; padding: 3px 8px; font-size: .68rem; font-weight: 700; }
      .billingpage .b-planfeatures { list-style: none; padding: 0; margin: 1rem 0 1.1rem; display: flex; flex-direction: column; gap: .4rem; flex: 1; }
      .billingpage .b-planfeatures li { color: var(--b-ink2); font-size: .78rem; display: flex; align-items: flex-start; gap: .5rem; }
      .billingpage .b-planfeatures li::before { content: '✓'; color: var(--b-green); flex-shrink: 0; font-weight: 700; }

      .billingpage .b-footnote { margin-top: 1.5rem; padding: 1rem 1.25rem; background: var(--b-surface2); border-radius: 12px; }
      .billingpage .b-footnote p { color: var(--b-ink2); font-size: .8rem; margin: 0; line-height: 1.6; }
      .billingpage .b-footnote a { color: var(--b-accent); font-weight: 700; }

      /* modals */
      .billingpage .b-modal-overlay { position: fixed; inset: 0; background: rgba(10,18,40,.5); display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 60; }
      .billingpage .b-modal { background: var(--b-surface); border-radius: 16px; padding: 1.75rem; max-width: 460px; width: 100%; box-shadow: 0 24px 64px rgba(10,18,40,.25); }
      .billingpage .b-modal h2 { font-size: 1.1rem; font-weight: 800; color: var(--b-ink); margin-bottom: .3rem; }
      .billingpage .b-modal-sub { color: var(--b-muted); font-size: .78rem; margin-bottom: 1.1rem; }
      .billingpage .b-modal-rows { background: var(--b-surface2); border-radius: 10px; padding: .9rem 1rem; margin-bottom: 1rem; }
      .billingpage .b-modal-row { display: flex; align-items: center; justify-content: space-between; font-size: .82rem; padding: .35rem 0; }
      .billingpage .b-modal-row span:first-child { color: var(--b-muted); }
      .billingpage .b-modal-row span:last-child { font-weight: 700; color: var(--b-ink); }
      .billingpage .b-strike { text-decoration: line-through; color: var(--b-muted); font-weight: 500 !important; margin-right: 6px; }
    `}</style>
  );
}
