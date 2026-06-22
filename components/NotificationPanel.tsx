// components/NotificationPanel.tsx
// The cracked-bell slide-over: the in-app alert MONITOR. A break-level gauge, a
// status-color row for every section, full monitor cards for what's active right
// now (value + trajectory since it broke + distance to the next tier / to
// clearing), a "recently cleared" log, and email signup. Same source as the
// email digest (the intelligence-tab alerts), so the two never disagree.
import { useEffect, useState } from 'react'
import { TIERS, type Severity } from '../lib/alertSeverity'
import { barFor, nextTierThreshold } from '../lib/alertMeta'

export type PanelAlert = {
  key: string
  id: string
  tab: string
  tabLabel: string
  severity: number
  title: string
  what?: string
  why?: string
  affected?: string[]
  context?: string
  firstSeen?: number
  lastSeen?: number
  triggerValue?: number | null
  value?: number | null
  peak?: number | null
  track?: number[]
}

export type SectionDot = { tab: string; tabLabel: string; tone: string }

const round = (v: number) => Math.round(v * 100) / 100
function fmt(v: number, unit: string): string {
  const n = Math.abs(v) >= 100 ? Math.round(v) : round(v)
  if (unit === '$') return `$${n}`
  if (unit === 'mo') return `${n} mo`
  return `${n}${unit}`
}
function agoLabel(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (d >= 1) return `${d} day${d > 1 ? 's' : ''} ago`
  if (h >= 1) return `${h} hour${h > 1 ? 's' : ''} ago`
  if (m >= 1) return `${m} min ago`
  return 'just now'
}
// Dark-tuned tier chip for the graphite drawer. Keeps the TIERS labels but
// overrides color/bg/border to the bright tone scale (TIERS itself stays light
// because the email digest shares it).
function tierStyle(sev: number) {
  if (sev >= 3) return { label: TIERS[3 as Severity].label, color: 'var(--bad)', bg: 'rgba(239,107,94,0.14)', border: 'var(--bad)' }
  if (sev === 1) return { label: TIERS[1 as Severity].label, color: 'var(--good)', bg: 'rgba(138,184,74,0.14)', border: 'var(--good)' }
  return { label: TIERS[2 as Severity].label, color: 'var(--warn)', bg: 'rgba(216,139,47,0.14)', border: 'var(--warn)' }
}
const TONE_RANK: Record<string, number> = { crisis: 5, bad: 4, warn: 3, neutral: 2, good: 1, unknown: 0 }
// Mirror the per-tab TONE_COLORS scale exactly so the status row agrees with
// what each tab's own status badge shows (neutral is yellow, not green).
function toneColor(tone: string): string {
  if (tone === 'crisis') return 'var(--crisis)'
  if (tone === 'bad') return 'var(--bad)'
  if (tone === 'warn') return 'var(--warn)'
  if (tone === 'neutral') return 'var(--neutral)'
  if (tone === 'good') return 'var(--good)'
  return '#9E9E9A'
}

function Spark({ points, color }: { points: number[]; color: string }) {
  if (!points || points.length < 2) return null
  const W = 84, H = 26
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1
  const pts = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W
    const y = H - ((v - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const [lx, ly] = pts[pts.length - 1].split(',')
  const [fx, fy] = pts[0].split(',')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', flexShrink: 0 }} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={fx} cy={fy} r="2.4" fill="var(--text-muted)" />
      <circle cx={lx} cy={ly} r="2.4" fill={color} />
    </svg>
  )
}

function MonitorCard({ a, onOpen }: { a: PanelAlert; onOpen: () => void }) {
  const tier = tierStyle(a.severity)
  const bar = barFor(a as never)
  const value = a.value ?? bar?.value ?? null
  const unit = bar?.unit ?? ''
  const dir = bar?.dir ?? 'above'
  const trig = a.triggerValue ?? null
  const since = value != null && trig != null ? round(value - trig) : null
  const worse = since != null && since !== 0 && (dir === 'below' ? since < 0 : since > 0)
  const toClear = value != null && bar ? Math.abs(round(value - bar.threshold)) : null
  const nt = nextTierThreshold(a.id)
  const toNext = nt && value != null ? round(nt.t - value) : null
  const spark = a.track && a.track.length >= 2 ? a.track : (trig != null && value != null ? [trig, value] : null)

  return (
    <div className="np-card" style={{ borderLeftColor: tier.border }}>
      <div className="np-card-top">
        <span className="np-chip" style={{ color: tier.color, background: tier.bg }}>{tier.label} · {a.tabLabel.toLowerCase()}</span>
        {a.firstSeen != null && <span className="np-ago">broke {agoLabel(a.firstSeen)}</span>}
      </div>
      <div className="np-card-title">{a.title}</div>

      {value != null && (
        <div className="np-monitor">
          <div className="np-value" style={{ color: tier.border }}>{fmt(value, unit)}</div>
          {spark && <Spark points={spark} color={worse ? '#E24B4A' : '#639922'} />}
          <div className="np-stats">
            {since != null && (
              <div style={{ color: since === 0 ? 'var(--text-muted)' : worse ? '#E24B4A' : '#639922' }}>
                {since === 0 ? '→ flat since it broke' : `${worse ? '↑' : '↓'} ${fmt(Math.abs(since), unit)} since it broke`}
              </div>
            )}
            {toNext != null && toNext > 0 && <div style={{ color: 'var(--text-secondary)' }}>{fmt(toNext, unit)} to the {fmt(nt!.t, nt!.unit)} line</div>}
            {toClear != null && <div style={{ color: 'var(--text-secondary)' }}>{fmt(toClear, unit)} from clearing</div>}
          </div>
        </div>
      )}

      {a.what && <div className="np-line"><span className="np-lab">What — </span>{a.what}</div>}
      {a.why && <div className="np-line"><span className="np-lab">Why — </span>{a.why}</div>}
      {a.affected && a.affected.length > 0 && (
        <>
          <div className="np-areas-label">areas affected</div>
          <div className="np-areas">{a.affected.map(x => <span key={x} className="np-area">{x.toLowerCase()}</span>)}</div>
        </>
      )}
      {a.context && <div className="np-ctx"><span className="np-lab" style={{ color: 'var(--text-secondary)' }}>Historically — </span>{a.context}</div>}
      <button className="np-open" style={{ color: tier.color }} onClick={onOpen}>Open {a.tabLabel.toLowerCase()} →</button>
    </div>
  )
}

export default function NotificationPanel({
  open, onClose, active, past, sections, onNavigate, authed,
}: {
  open: boolean
  onClose: () => void
  active: PanelAlert[]
  past: PanelAlert[]
  sections: SectionDot[]
  onNavigate: (tab: string) => void
  authed?: boolean
}) {
  const [brk, setBrk] = useState<{ total: number; level: string } | null>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/breakmeter').then(r => r.json()).then(d => {
      if (typeof d.total === 'number') setBrk({ total: d.total, level: d.level })
    }).catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const go = (tab: string) => { onNavigate(tab); onClose() }
  const rankedSections = [...sections].sort((a, b) => (TONE_RANK[b.tone] ?? 0) - (TONE_RANK[a.tone] ?? 0))
  const gaugePct = brk ? Math.max(3, Math.min(100, Math.round(brk.total))) : 0
  const gaugeColor = !brk ? '#9E9E9A' : brk.total < 25 ? '#639922' : brk.total < 65 ? '#BA7517' : '#E24B4A'

  return (
    <>
      <div className="np-backdrop" onClick={onClose} />
      <div className="np-drawer" role="dialog" aria-label="Alerts">
        <div className="np-head">
          <span className="np-head-title">Alerts</span>
          <button className="np-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="np-scroll">
          {brk && (
            <div className="np-gauge">
              <div className="np-gauge-track"><div className="np-gauge-fill" style={{ width: `${gaugePct}%`, background: gaugeColor }} /></div>
              <span className="np-gauge-label">break level {Math.round(brk.total)} · {brk.level}</span>
            </div>
          )}

          {rankedSections.length > 0 && (
            <div className="np-status">
              {rankedSections.map(s => (
                <button key={s.tab} className="np-status-item" onClick={() => go(s.tab)}>
                  <span className="np-dot" style={{ background: toneColor(s.tone) }} />{s.tabLabel.toLowerCase()}
                </button>
              ))}
            </div>
          )}

          {active.length > 0 && (
            <div className="np-section">
              <div className="np-section-label">active · {active.length}</div>
              {active.map(a => <MonitorCard key={a.key} a={a} onOpen={() => go(a.tab)} />)}
            </div>
          )}

          {past.length > 0 && (
            <div className="np-section">
              <div className="np-section-label">recently cleared · {past.length}</div>
              {past.map(a => {
                const unit = barFor(a as never)?.unit ?? ''
                return (
                  <div key={a.key} className="np-cleared">
                    <span className="np-cleared-check">✓</span>
                    <div>
                      <div className="np-cleared-title">{a.title}</div>
                      <div className="np-cleared-sub">cleared {agoLabel(a.lastSeen ?? Date.now())}{a.peak != null ? ` · peaked at ${fmt(a.peak, unit)}` : ''}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {active.length === 0 && past.length === 0 && (
            <div className="np-empty">
              <div className="np-empty-mark">✓</div>
              Nothing is breaking right now.<br />We'll surface alerts here the moment they do.
            </div>
          )}
        </div>

        <div className="np-sub">
          <div className="np-sub-label">{authed ? 'Email alerts go out to your inbox.' : 'Want these by email?'}</div>
          <a className="np-cta" href={authed ? '/settings' : '/welcome'}>
            {authed ? 'Manage your alerts' : 'Sign in to receive alerts'}
          </a>
        </div>
      </div>

      <style>{`
        .np-backdrop { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,0.4); }
        .np-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 91; width: min(440px, 100vw);
          display: flex; flex-direction: column; background: var(--card-bg); border-left: 0.5px solid var(--border-med);
          box-shadow: -14px 0 44px rgba(0,0,0,0.20); }
        .np-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 0.5px solid var(--border); flex-shrink: 0; }
        .np-head-title { font-size: 15px; font-weight: 500; color: var(--text-primary); }
        .np-close { background: none; border: none; cursor: pointer; font-size: 22px; line-height: 1; color: var(--text-muted); padding: 0 2px; }
        .np-scroll { overflow-y: auto; padding: 14px 16px; flex: 1; }
        .np-gauge { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .np-gauge-track { flex: 1; height: 5px; border-radius: 3px; background: var(--border-med); overflow: hidden; }
        .np-gauge-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
        .np-gauge-label { font-family: var(--mono); font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
        .np-status { display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 12px 0; margin-bottom: 16px; border-top: 0.5px solid var(--border); border-bottom: 0.5px solid var(--border); }
        .np-status-item { background: none; border: none; cursor: pointer; font-family: var(--mono); font-size: 12px; color: var(--text-secondary); display: inline-flex; align-items: center; padding: 0; }
        .np-status-item:hover { color: var(--text-primary); }
        .np-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
        .np-section { margin-bottom: 16px; }
        .np-section-label { font-size: 11px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 10px; }
        .np-card { border: 0.5px solid var(--border); border-left: 3px solid var(--border-med); border-radius: 0 8px 8px 0; padding: 13px 15px; margin-bottom: 12px; background: var(--card-bg); }
        .np-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
        .np-chip { font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 5px; font-family: var(--mono); }
        .np-ago { font-size: 11px; font-family: var(--mono); color: var(--text-muted); white-space: nowrap; }
        .np-card-title { font-size: 15px; font-weight: 500; color: var(--text-primary); line-height: 1.35; margin-bottom: 12px; }
        .np-monitor { display: flex; align-items: center; gap: 13px; margin-bottom: 12px; }
        .np-value { font-family: var(--mono); font-size: 22px; font-weight: 500; line-height: 1; flex-shrink: 0; }
        .np-stats { font-family: var(--mono); font-size: 11px; line-height: 1.55; }
        .np-line { font-size: 13px; line-height: 1.55; color: var(--text-secondary); margin-bottom: 7px; }
        .np-lab { color: var(--text-primary); font-weight: 500; }
        .np-areas-label { font-size: 10px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 12px 0 7px; }
        .np-areas { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 9px; }
        .np-area { font-size: 11px; color: var(--text-secondary); background: var(--bg); padding: 3px 8px; border-radius: 5px; font-family: var(--mono); }
        .np-ctx { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-bottom: 10px; }
        .np-open { background: none; border: none; cursor: pointer; padding: 0; font-family: var(--sans); font-size: 12px; font-weight: 500; }
        .np-cleared { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; background: var(--bg); border-radius: 8px; margin-bottom: 8px; }
        .np-cleared-check { color: #639922; font-size: 14px; line-height: 1.4; }
        .np-cleared-title { font-size: 13px; color: var(--text-primary); }
        .np-cleared-sub { font-size: 11.5px; font-family: var(--mono); color: var(--text-muted); margin-top: 2px; }
        .np-empty { text-align: center; color: var(--text-muted); font-size: 12.5px; line-height: 1.6; padding: 44px 20px; }
        .np-empty-mark { font-size: 24px; color: var(--term); margin-bottom: 8px; }
        .np-sub { border-top: 0.5px solid var(--border); padding: 13px 16px; background: var(--bg); flex-shrink: 0; }
        .np-sub-label { font-size: 11px; color: var(--text-secondary); margin-bottom: 9px; }
        .np-cta { display: block; text-align: center; font-family: var(--sans); font-size: 12.5px; font-weight: 500;
          text-decoration: none; padding: 9px 13px; border-radius: 6px; background: var(--term); color: #fff; }
        .np-cta:hover { opacity: 0.92; }
      `}</style>
    </>
  )
}
