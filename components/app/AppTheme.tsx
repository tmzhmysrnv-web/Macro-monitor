// components/app/AppTheme.tsx
// The calm, light visual language for the SIGNED-IN app (dashboard, onboarding,
// settings…). Everything is scoped under `.app` so it never touches the public
// graphite site's global `:root`. Drops in the shared fonts + base components
// (buttons, cards, inputs, toggles, badges, interest pick-cards).
// Fonts are loaded once via next/font in _app.tsx and exposed as :root vars.

export default function AppTheme() {
  return (
    <>
      <style>{`
        .app {
          --c-bg: #232522; --c-surface: #F0F2EC; --c-soft: #E3EADF; --c-soft-line: #CCD7C8;
          --c-border: rgba(28,35,30,.12); --c-border-strong: rgba(28,35,30,.22);
          --c-text: #1F2924; --c-text-soft: #59645D; --c-muted: #7E887F;
          --c-green: #2F9160; --c-green-deep: #2F7C55; --c-green-bg: #DCEBDD;
          --c-ok: #2F9160; --c-warn: #B8731B; --c-warn-bg: #F4EAD8; --c-bad: #C84F49; --c-bad-bg: #F3DEDB;
          --c-shell-bg: #1B1C1F; --c-shell-border: rgba(255,255,255,.09);
          --c-shell-text: #F2F2EF; --c-shell-text-soft: #C8CBC5; --c-shell-muted: #969A93;
          --c-shell-green: #8AB84A; --c-shell-amber: #D88B2F;
          --c-sans: var(--font-dm-sans), 'DM Sans', system-ui, sans-serif; --c-mono: var(--font-dm-mono), 'DM Mono', monospace;
          background: var(--c-bg); color: var(--c-text); font-family: var(--c-sans);
          min-height: 100vh; -webkit-font-smoothing: antialiased;
        }
        .app * { box-sizing: border-box; }
        .app a { color: var(--c-green-deep); text-decoration: none; }
        .app a:hover { text-decoration: underline; }

        /* Site identity — mirrors the public site's .site-name (Space Mono, lowercase,
           blinking terminal cursor), tinted for the graphite shell. No logo glyph. */
        .app .brand { font-family: var(--font-space-mono), 'Space Mono', var(--c-mono); font-size: 14px; font-weight: 400;
          letter-spacing: 0.04em; color: var(--c-shell-green); line-height: 1.3; }
        .app .brand-cursor { display: inline-block; width: 0.5em; height: 0.95em; margin-left: 3px;
          vertical-align: -0.1em; background: var(--c-shell-green); animation: brandblink 1.2s steps(1, end) infinite; }
        @keyframes brandblink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }

        /* ── buttons ── */
        .app .btn { font-family: var(--c-sans); font-size: 14px; font-weight: 500; cursor: pointer;
          border-radius: 10px; padding: 11px 18px; border: 1px solid transparent; display: inline-flex;
          align-items: center; justify-content: center; gap: 8px; transition: background .15s, border-color .15s, opacity .15s; }
        .app .btn:disabled { opacity: .6; cursor: default; }
        .app .btn-primary { background: var(--c-green); color: #fff; }
        .app .btn-primary:hover:not(:disabled) { background: var(--c-green-deep); }
        .app .btn-ghost { background: var(--c-surface); border-color: var(--c-border-strong); color: var(--c-text); }
        .app .btn-ghost:hover:not(:disabled) { border-color: var(--c-muted); }
        .app .btn-google { background: #fff; border-color: var(--c-border-strong); color: var(--c-text); }
        .app .btn-google:hover:not(:disabled) { border-color: var(--c-muted); }
        .app .btn-block { width: 100%; }
        .app .btn-danger { background: var(--c-bad-bg); color: var(--c-bad); border-color: #EAC6C3; }
        .app .btn-danger:hover:not(:disabled) { background: #F7DEDB; }

        /* ── inputs ── */
        .app .field { width: 100%; font-family: var(--c-sans); font-size: 14px; padding: 11px 13px;
          border-radius: 10px; border: 1px solid var(--c-border-strong); background: #fff; color: var(--c-text); }
        .app .field:focus { outline: none; border-color: var(--c-green); box-shadow: 0 0 0 3px var(--c-green-bg); }
        .app .label { font-size: 12px; font-weight: 500; color: var(--c-text-soft); margin-bottom: 6px; display: block; }

        /* ── cards ── */
        .app .calm-card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 16px; padding: 22px; }
        .app .calm-card.soft { background: var(--c-soft); border-color: var(--c-soft-line); }

        /* ── badges ── */
        .app .badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px; }
        .app .badge-ok { background: var(--c-green-bg); color: var(--c-green-deep); }
        .app .badge-warn { background: var(--c-warn-bg); color: var(--c-warn); }
        .app .badge-alert { background: var(--c-bad-bg); color: var(--c-bad); }

        /* ── toggle switch ── */
        .app .switch { position: relative; width: 42px; height: 24px; flex-shrink: 0; cursor: pointer; }
        .app .switch input { opacity: 0; width: 0; height: 0; }
        .app .switch .track { position: absolute; inset: 0; background: var(--c-border-strong); border-radius: 999px; transition: background .18s; }
        .app .switch .knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; background: #fff; border-radius: 50%; transition: transform .18s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
        .app .switch input:checked + .track { background: var(--c-green); }
        .app .switch input:checked + .track + .knob,
        .app .switch input:checked ~ .knob { transform: translateX(18px); }

        /* ── segmented control ── */
        .app .seg { display: inline-flex; background: var(--c-soft); border: 1px solid var(--c-soft-line); border-radius: 10px; padding: 3px; gap: 3px; flex-wrap: wrap; }
        .app .seg button { font-family: var(--c-sans); font-size: 13px; border: none; background: none; color: var(--c-text-soft); padding: 7px 14px; border-radius: 8px; cursor: pointer; }
        .app .seg button.on { background: #fff; color: var(--c-text); font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,.06); }

        /* ── interest pick-card (onboarding / watchlist) ── */
        .app .pickgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px; }
        .app .pickcard { text-align: left; background: var(--c-surface); border: 1.5px solid var(--c-border); border-radius: 14px; padding: 16px; cursor: pointer; transition: border-color .15s, background .15s; }
        .app .pickcard:hover { border-color: var(--c-border-strong); }
        .app .pickcard.sel { border-color: var(--c-green); background: var(--c-green-bg); }
        .app .pickcard .pc-icon { color: var(--c-green-deep); margin-bottom: 10px; }
        .app .pickcard .pc-title { font-size: 15px; font-weight: 600; margin-bottom: 3px; }
        .app .pickcard .pc-blurb { font-size: 12px; color: var(--c-text-soft); line-height: 1.45; }

        /* ── auth screen layout ── */
        .app.auth-screen { display: flex; align-items: center; justify-content: center; padding: 32px 20px; }
        .app .auth-box { width: 100%; max-width: 420px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 18px; padding: 26px; }
        .app .auth-brand { display: flex; align-items: center; gap: 9px; justify-content: center; color: var(--c-green-deep); margin-bottom: 26px; }
        .app .auth-brand span { font-size: 15px; font-weight: 600; }
        .app .auth-h1 { font-size: 28px; font-weight: 600; text-align: center; letter-spacing: -0.01em; }
        .app .auth-title { font-family: var(--font-space-mono), 'Space Mono', var(--c-mono); font-size: 22px; font-weight: 400;
          letter-spacing: 0.03em; color: var(--c-green-deep); text-align: center; }
        .app .auth-sub { font-size: 14px; color: var(--c-text-soft); text-align: center; line-height: 1.55; margin: 10px 0 26px; }
        .app .divider { display: flex; align-items: center; gap: 12px; color: var(--c-muted); font-size: 12px; margin: 18px 0; }
        .app .divider::before, .app .divider::after { content: ''; flex: 1; height: 1px; background: var(--c-border); }
        .app .auth-err { font-size: 13px; color: var(--c-bad); margin-top: 12px; text-align: center; }
        .app .auth-note { font-size: 13px; color: var(--c-text-soft); margin-top: 14px; text-align: center; line-height: 1.5; }
        .app .auth-switch { background: none; border: none; color: var(--c-green-deep); cursor: pointer; font-size: 13px; font-family: var(--c-sans); }
      `}</style>
    </>
  )
}
