// components/NotificationPanel.tsx
// The cracked-bell popover: what's firing right now (derived from the already-
// fetched tab models), the recent feed (server, populated by the daily cron),
// and an email-alert signup. Styled inline against the app's CSS variables.
import { useEffect, useState } from 'react'
import { TIERS, type Severity } from '../lib/alertSeverity'

export type PanelAlert = {
  key: string
  tab: string
  tabLabel: string
  severity: number
  title: string
  what?: string
  ts?: number
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return `${d}d ago`
}

function tierOf(sev: number) {
  return TIERS[(sev as Severity)] ?? TIERS[2]
}

function AlertRow({ a, onClick }: { a: PanelAlert; onClick: () => void }) {
  const tier = tierOf(a.severity)
  return (
    <button onClick={onClick} className="np-row" style={{ borderLeftColor: tier.color }}>
      <div className="np-row-top">
        <span className="np-tag" style={{ color: tier.color, background: tier.bg }}>{a.tabLabel}</span>
        {a.ts != null && <span className="np-time">{relTime(a.ts)}</span>}
      </div>
      <div className="np-title">{a.title}</div>
      {a.what && <div className="np-what">{a.what}</div>}
    </button>
  )
}

export default function NotificationPanel({
  open, onClose, active, past, onNavigate,
}: {
  open: boolean
  onClose: () => void
  active: PanelAlert[]
  past: PanelAlert[]
  onNavigate: (tab: string) => void
}) {
  const [feed, setFeed] = useState<PanelAlert[]>([])
  const [email, setEmail] = useState('')
  const [subState, setSubState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [subMsg, setSubMsg] = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => setFeed(Array.isArray(d.items) ? d.items : []))
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const activeKeys = new Set(active.map(a => a.key))
  // "Earlier" = locally cleared alerts + the server feed, minus anything currently
  // active and de-duped by key (prefer the local copy).
  const pastByKey = new Map(past.map(a => [a.key, a]))
  for (const f of feed) if (!activeKeys.has(f.key) && !pastByKey.has(f.key)) pastByKey.set(f.key, f)
  const earlier = [...pastByKey.values()]
    .filter(a => !activeKeys.has(a.key))
    .sort((x, y) => (y.ts ?? 0) - (x.ts ?? 0))

  const go = (tab: string) => { onNavigate(tab); onClose() }

  async function subscribe(e: React.FormEvent) {
    e.preventDefault()
    setSubState('loading'); setSubMsg('')
    try {
      const r = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const d = await r.json()
      if (r.ok) { setSubState('done'); setSubMsg(d.message || 'Check your inbox to confirm.') }
      else { setSubState('error'); setSubMsg(d.error || 'Something went wrong.') }
    } catch {
      setSubState('error'); setSubMsg('Network error. Try again.')
    }
  }

  return (
    <>
      <div className="np-backdrop" onClick={onClose} />
      <div className="np-panel" role="dialog" aria-label="Notifications">
        <div className="np-head">
          <span className="np-head-title">Notifications</span>
          <button className="np-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="np-scroll">
          {active.length > 0 && (
            <div className="np-section">
              <div className="np-section-label">Active now · {active.length}</div>
              {active.map(a => <AlertRow key={a.key} a={a} onClick={() => go(a.tab)} />)}
            </div>
          )}

          {earlier.length > 0 && (
            <div className="np-section">
              <div className="np-section-label">Earlier</div>
              {earlier.map(a => <AlertRow key={a.key + (a.ts ?? '')} a={a} onClick={() => go(a.tab)} />)}
            </div>
          )}

          {active.length === 0 && earlier.length === 0 && (
            <div className="np-empty">
              <div className="np-empty-mark">✓</div>
              Nothing is breaking right now.<br />We'll surface alerts here the moment they do.
            </div>
          )}
        </div>

        <form className="np-sub" onSubmit={subscribe}>
          {subState === 'done' ? (
            <div className="np-sub-done">{subMsg}</div>
          ) : (
            <>
              <div className="np-sub-label">Get these by email</div>
              <div className="np-sub-row">
                <input
                  type="email" required value={email} placeholder="you@example.com"
                  onChange={e => setEmail(e.target.value)} className="np-input"
                  disabled={subState === 'loading'}
                />
                <button type="submit" className="np-btn" disabled={subState === 'loading'}>
                  {subState === 'loading' ? '…' : 'Subscribe'}
                </button>
              </div>
              {subState === 'error' && <div className="np-sub-err">{subMsg}</div>}
            </>
          )}
        </form>
      </div>

      <style>{`
        .np-backdrop { position: fixed; inset: 0; z-index: 90; background: transparent; }
        .np-panel {
          position: fixed; z-index: 91; top: 64px; right: clamp(1rem, 4vw, 4rem);
          width: min(360px, calc(100vw - 2rem)); max-height: min(70vh, 560px);
          display: flex; flex-direction: column;
          background: var(--card-bg); border: 0.5px solid var(--border-med);
          border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.18);
          overflow: hidden;
        }
        .np-head { display: flex; align-items: center; justify-content: space-between;
          padding: 12px 14px; border-bottom: 0.5px solid var(--border); }
        .np-head-title { font-size: 13px; font-weight: 500; color: var(--text-primary); }
        .np-close { background: none; border: none; cursor: pointer; font-size: 20px;
          line-height: 1; color: var(--text-muted); padding: 0 2px; }
        .np-scroll { overflow-y: auto; padding: 6px; flex: 1; }
        .np-section { margin-bottom: 8px; }
        .np-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.07em;
          text-transform: uppercase; color: var(--text-muted); font-family: var(--mono);
          padding: 8px 8px 6px; }
        .np-row { display: block; width: 100%; text-align: left; cursor: pointer;
          background: none; border: none; border-left: 2px solid transparent;
          padding: 9px 10px; border-radius: 6px; transition: background 0.12s; }
        .np-row:hover { background: var(--border); }
        .np-row-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
        .np-tag { font-size: 9px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
          padding: 2px 6px; border-radius: 4px; font-family: var(--mono); }
        .np-time { font-size: 10px; color: var(--text-muted); font-family: var(--mono); white-space: nowrap; }
        .np-title { font-size: 13px; font-weight: 500; color: var(--text-primary); line-height: 1.4; }
        .np-what { font-size: 11.5px; color: var(--text-secondary); line-height: 1.45; margin-top: 2px; }
        .np-empty { text-align: center; color: var(--text-muted); font-size: 12.5px; line-height: 1.6; padding: 36px 20px; }
        .np-empty-mark { font-size: 22px; color: var(--term); margin-bottom: 8px; }
        .np-sub { border-top: 0.5px solid var(--border); padding: 12px 14px; background: var(--bg); }
        .np-sub-label { font-size: 11px; color: var(--text-secondary); margin-bottom: 7px; }
        .np-sub-row { display: flex; gap: 6px; }
        .np-input { flex: 1; min-width: 0; font-family: var(--mono); font-size: 12px;
          padding: 7px 9px; border-radius: 6px; border: 0.5px solid var(--border-med);
          background: var(--card-bg); color: var(--text-primary); }
        .np-input:focus { outline: none; border-color: var(--term); }
        .np-btn { font-family: var(--sans); font-size: 12px; font-weight: 500; cursor: pointer;
          padding: 7px 12px; border-radius: 6px; border: none; background: var(--term); color: #fff;
          white-space: nowrap; }
        .np-btn:disabled { opacity: 0.6; cursor: default; }
        .np-sub-done { font-size: 12px; color: var(--term); line-height: 1.5; }
        .np-sub-err { font-size: 11px; color: #E24B4A; margin-top: 6px; }
      `}</style>
    </>
  )
}
