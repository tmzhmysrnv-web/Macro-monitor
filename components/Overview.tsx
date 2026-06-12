// components/Overview.tsx
// The Overview tab — an economic early-warning control room.
// Order answers the page's question fastest: Alerts → Break Meter → Recent
// Breaks → Watching → Drivers → What Changed → Today's Situation.
import { useEffect, useState } from 'react'
import type { MacroData } from '../lib/fetchData'
import { buildAlertCards, type AlertCard } from '../lib/alertCards'

type Driver = { key: string; label: string; stress: number; status: string; driver: string; driverKey: string; trend: 'up' | 'down' | 'flat'; share: number }
type ChangeRow = { key: string; label: string; why: string; current: number; weekAgo: number; unit: string; direction: string; significance: number }
type Alert = { key: string; label: string; message: string }
type WatchItem = { key: string; label: string; text: string; heat: 'hot' | 'near' }
type BreakEvent = { key: string; text: string; tone: 'bad' | 'good'; date: string; daysAgo: number }
type Briefing = { headline: string; concern: { label: string; detail: string } | null; stabilizer: { label: string; detail: string } | null }
type EventItem = { name: string; date: string; daysUntil: number; description: string }
type BreakMeter = {
  available: boolean
  total: number; level: string; verdict: string
  drivers: Driver[]
  whatChanged: ChangeRow[]
  alerts: Alert[]
  watching: WatchItem[]
  recentBreaks: BreakEvent[]
  briefing: Briefing
  concern: { label: string; detail: string } | null
}

const CAT_COLORS: Record<string, string> = {
  calm: '#639922', watch: '#8FA31E', elevated: '#BA7517', stressed: '#D9622B', breaking: '#E24B4A',
}

// Spec severity scale — drives the prominent status label on the meter
function severity(total: number): { label: string; color: string } {
  if (total <= 20) return { label: 'Healthy', color: '#639922' }
  if (total <= 40) return { label: 'Worth Watching', color: '#8FA31E' }
  if (total <= 60) return { label: 'Elevated', color: '#BA7517' }
  if (total <= 80) return { label: 'High Risk', color: '#D9622B' }
  return { label: 'Breaking', color: '#E24B4A' }
}

function fmt(key: string, v: number): string {
  if (key === 'sp500') return v.toLocaleString('en-US')
  if (key === 'gold') return `$${v.toLocaleString('en-US')}`
  if (key === 'oil') return `$${v.toFixed(2)}`
  if (key === 'copper') return `$${v.toFixed(3)}`
  if (key === 'joblessClaims') return `${v.toFixed(0)}k`
  if (key === 'dxy') return v.toFixed(2)
  if (key === 'yieldCurve') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  if (['treasury10y','fedfunds','cpi','hySpread','igSpread','mortgage30','vix'].includes(key)) {
    return key === 'vix' ? v.toFixed(1) : `${v.toFixed(2)}%`
  }
  return v.toFixed(1)
}

const MARKERS = [
  { date: '2008-09', label: '2008 crisis' },
  { date: '2020-03', label: 'COVID' },
  { date: '2022-06', label: 'rate hikes' },
]

function BreakMeterTrend({ history, color }: { history: { date: string; value: number }[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!history || history.length < 2) {
    return <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', padding: '2rem 0', textAlign: 'center' }}>Building history…</div>
  }
  const W = 640, H = 160, PAD = { t: 12, r: 12, b: 24, l: 28 }
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const vals = history.map(h => h.value)
  const min = 0, max = Math.max(100, ...vals)
  const toX = (i: number) => PAD.l + (i / (history.length - 1)) * iw
  const toY = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih
  const line = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.value).toFixed(1)}`).join(' ')
  const area = `${line} ${toX(history.length - 1).toFixed(1)},${(PAD.t + ih).toFixed(1)} ${PAD.l},${(PAD.t + ih).toFixed(1)}`

  const markerIdx = MARKERS.map(m => ({
    ...m, idx: history.findIndex(h => h.date.slice(0, 7) === m.date),
  })).filter(m => m.idx >= 0)

  const hv = hover != null ? history[hover] : null

  function move(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = (e.clientX - r.left) * (W / r.width)
    const idx = Math.round(((mx - PAD.l) / iw) * (history.length - 1))
    setHover(Math.max(0, Math.min(history.length - 1, idx)))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
        <span style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>10-year trend</span>
        {hv && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
            <span style={{ color, fontWeight: 500 }}>{hv.value}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{hv.date.slice(0, 7)}</span>
          </span>
        )}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', cursor: 'crosshair', overflow: 'visible' }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="bmgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map(t => (
          <g key={t}>
            <line x1={PAD.l} y1={toY(t)} x2={PAD.l + iw} y2={toY(t)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.l - 5} y={toY(t) + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)" fontFamily="monospace">{t}</text>
          </g>
        ))}
        {markerIdx.map((m, i) => (
          <g key={i}>
            <line x1={toX(m.idx)} y1={PAD.t} x2={toX(m.idx)} y2={PAD.t + ih} stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
            <text x={toX(m.idx)} y={PAD.t + 8} textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="monospace">{m.label}</text>
          </g>
        ))}
        <polygon points={area} fill="url(#bmgrad)" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {hover != null && (
          <g>
            <line x1={toX(hover)} y1={PAD.t} x2={toX(hover)} y2={PAD.t + ih} stroke="var(--text-muted)" strokeWidth="0.5" />
            <circle cx={toX(hover)} cy={toY(history[hover].value)} r="3.5" fill={color} stroke="var(--card-bg)" strokeWidth="1.5" />
          </g>
        )}
      </svg>
    </div>
  )
}

function AlertCardView({ card, onView }: { card: AlertCard; onView?: (key: string, label: string) => void }) {
  const dirColor = card.direction === 'Rising' ? '#A32D2D' : card.direction === 'Cooling' ? '#3B6D11' : 'var(--text-secondary)'
  const dirArrow = card.direction === 'Rising' ? '↑' : card.direction === 'Cooling' ? '↓' : '→'
  return (
    <div className="ac">
      {/* Header */}
      <div className="ac-head">
        <div className="ac-icon">{card.icon}</div>
        <div className="ac-head-main">
          <div className="ac-title">{card.title}</div>
          <div className="ac-new"><span className="ac-new-dot" /> Active alert</div>
        </div>
      </div>

      <div className="ac-body">
        {/* Left: the numbers */}
        <div className="ac-stats">
          <div className="ac-stat"><span className="ac-stat-k">Current value</span><span className="ac-stat-v">{card.current}</span></div>
          <div className="ac-stat"><span className="ac-stat-k">Threshold</span><span className="ac-stat-v">{card.threshold}</span></div>
          {card.triggered && <div className="ac-stat"><span className="ac-stat-k">Triggered</span><span className="ac-stat-v">{card.triggered}</span></div>}
          <div className="ac-stat"><span className="ac-stat-k">Direction</span><span className="ac-stat-v" style={{ color: dirColor }}>{dirArrow} {card.direction}</span></div>
        </div>

        {/* Why it matters */}
        <div className="ac-col">
          <div className="ac-col-h">Why it matters</div>
          <div className="ac-why">{card.whyItMatters}</div>
        </div>

        {/* Affected areas */}
        {card.affectedAreas.length > 0 && (
          <div className="ac-col">
            <div className="ac-col-h">Affected areas</div>
            <div className="ac-areas">
              {card.affectedAreas.map((a, i) => (
                <div className="ac-area" key={i}>
                  <span className="ac-area-icon">{a.icon}</span>
                  <span className="ac-area-text"><strong>{a.label}</strong>{a.desc ? ` — ${a.desc}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Historical context */}
        <div className="ac-col">
          <div className="ac-col-h">Historical context</div>
          {card.historicalContext.map((c, i) => (
            <div className="ac-ctx" key={i}>{c}</div>
          ))}
          {onView && (
            <button className="ac-view" onClick={() => onView(card.key, card.name)}>{card.viewLabel} →</button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Overview({ data = null, events = [], onViewCard }: { data?: MacroData | null; events?: EventItem[]; onViewCard?: (key: string, label: string) => void }) {
  const [bm, setBm] = useState<BreakMeter | null>(null)
  const [loading, setLoading] = useState(true)
  const [trend, setTrend] = useState<{ date: string; value: number }[] | null>(null)
  const [full, setFull] = useState<string | null>(null)
  const [showFull, setShowFull] = useState(false)

  useEffect(() => {
    // Fast: score + alerts + drivers paint as soon as this returns.
    fetch('/api/breakmeter')
      .then(r => r.json())
      .then(d => { setBm(d); setLoading(false) })
      .catch(() => setLoading(false))
    // Slow: the 10-year trend streams in separately, so it never blocks the meter.
    fetch('/api/trend')
      .then(r => r.json())
      .then(d => setTrend(d?.history ?? null))
      .catch(() => {})
    fetch('/api/summary')
      .then(r => r.json())
      .then(d => setFull(d?.text ?? null))
      .catch(() => {})
  }, [])

  const sev = bm ? severity(bm.total) : { label: '', color: '#639922' }
  const color = sev.color
  // Alerts are derived from the SAME data the top-bar pill uses, so the two can
  // never disagree. Trend (Rising/Cooling) + triggered date come from the meter
  // payload when it's loaded, but the alert list itself does not depend on it.
  const directions: Record<string, 'up' | 'down' | 'flat'> = {}
  for (const r of bm?.whatChanged ?? []) directions[r.key] = r.direction === 'toward-danger' ? 'up' : r.direction === 'toward-safety' ? 'down' : 'flat'
  const triggered: Record<string, string> = {}
  for (const e of bm?.recentBreaks ?? []) if (!triggered[e.key]) triggered[e.key] = e.date
  const alertCards: AlertCard[] = data ? buildAlertCards(data, { directions, triggered }) : []
  const dataReady = data != null
  const primaryRisks = (bm?.drivers ?? []).filter(d => d.stress >= 25).slice(0, 2).map(d => d.label)
  const nextEvent = events.length ? [...events].sort((a, b) => a.daysUntil - b.daysUntil)[0] : null

  // The 10-year trend (loaded separately) with today's live reading appended.
  const today = new Date().toISOString().split('T')[0]
  const trendLine = trend && bm
    ? [...trend.filter(p => p.date.slice(0, 7) !== today.slice(0, 7)), { date: today, value: bm.total }]
    : []

  // Gauge geometry
  const R = 64, CX = 80, CY = 80
  const total = bm?.total ?? 0
  const angle = Math.PI * (1 - total / 100)
  const endX = CX + R * Math.cos(angle), endY = CY - R * Math.sin(angle)

  // Data-unavailable guard
  if (bm && bm.available === false) {
    return (
      <div className="ov-unavail">
        <div className="ov-unavail-title">Live data is temporarily unavailable</div>
        <div className="ov-unavail-sub">The data feed is rate-limited right now. The Break Meter will refresh automatically shortly.</div>
        <style>{ovStyles}</style>
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Active Alerts ── */}
      <div className={`alerts-box ${alertCards.length ? 'is-alert' : 'is-clear'}`}>
        <div className="alerts-head">
          <span className={`alerts-dot ${alertCards.length ? 'is-pulse' : ''}`} style={{ background: alertCards.length ? '#E24B4A' : '#639922' }} />
          {!dataReady ? 'Checking alerts…'
            : alertCards.length ? `${alertCards.length} Active Alert${alertCards.length > 1 ? 's' : ''}`
            : 'No Active Alerts'}
        </div>
        {dataReady && alertCards.length === 0 && (
          <div className="alerts-clear-sub">Nothing important is currently breaking.</div>
        )}
        {dataReady && alertCards.length > 0 && bm?.concern && (
          <div className="alerts-concern-inline">
            Most significant concern: <strong>{bm.concern.label}</strong>{bm.concern.detail ? ` · ${bm.concern.detail}` : ''}
          </div>
        )}
      </div>

      {alertCards.map(a => (
        <AlertCardView key={a.key} card={a} onView={onViewCard} />
      ))}

      {/* ── 2. Break Meter ── */}
      <div className="bm-hero">
        <div className="bm-gauge">
          <svg width="160" height="96" viewBox="0 0 160 96">
            <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}`} fill="none" stroke="var(--border-med)" strokeWidth="9" strokeLinecap="round" />
            {bm && <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />}
            <text x={CX} y={CY-4} textAnchor="middle" fontSize="26" fontWeight="500" fontFamily="var(--mono)" fill="var(--text-primary)">{bm ? bm.total : '—'}</text>
            <text x={CX} y={CY+11} textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-muted)">/ 100</text>
          </svg>
          <div className="bm-sev" style={{ color }}>{sev.label}</div>
          <div className="bm-label">Break Meter</div>
          {primaryRisks.length > 0 && (
            <div className="bm-risks">Primary risks: {primaryRisks.join(', ')}</div>
          )}
        </div>
        <div className="bm-trend">
          <BreakMeterTrend history={trendLine} color={color} />
        </div>
      </div>

      {/* ── 3 + 4. Recent Breaks · Watching Closely ── */}
      <div className="panels">
        <div className="panel">
          <div className="panel-title">Recent breaks</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.recentBreaks.length === 0 && <div className="panel-empty">No notable thresholds crossed recently.</div>}
          {bm && bm.recentBreaks.map((e, i) => (
            <div className="rb-row" key={i}>
              <span className="rb-dot" style={{ background: e.tone === 'bad' ? '#E24B4A' : '#639922' }} />
              <span className="rb-text">{e.text}</span>
              <span className="rb-ago">{e.daysAgo <= 0 ? 'today' : e.daysAgo === 1 ? '1d ago' : `${e.daysAgo}d ago`}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-title">Watching closely</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.watching.length === 0 && <div className="panel-empty">Nothing close to an alert threshold.</div>}
          {bm && bm.watching.map(w => (
            <div className="wc-row" key={w.key}>
              <span className="wc-icon">{w.heat === 'hot' ? '🔥' : '⚠️'}</span>
              <span className="wc-label">{w.label}</span>
              <span className="wc-dist">{w.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5 + 6. Drivers · What Changed ── */}
      <div className="panels">
        <div className="panel">
          <div className="panel-title">Drivers of the Break Meter</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.drivers.map(d => {
            const arrow = d.trend === 'up' ? '↑' : d.trend === 'down' ? '↓' : ''
            const arrowColor = d.trend === 'up' ? '#A32D2D' : d.trend === 'down' ? '#3B6D11' : 'var(--text-muted)'
            return (
              <div className="driver-row" key={d.key}>
                <div className="driver-head">
                  <span className="driver-label">
                    {d.label}
                    {arrow && <span className="driver-arrow" style={{ color: arrowColor }}> {arrow}</span>}
                    {d.driver ? <span className="driver-sub"> · {d.driver}</span> : null}
                  </span>
                  <span className="driver-pct" style={{ color: CAT_COLORS[d.status] }}>{d.share}%</span>
                </div>
                <div className="driver-bar">
                  <div className="driver-fill" style={{ width: `${d.share}%`, background: CAT_COLORS[d.status] }} />
                </div>
              </div>
            )
          })}
          {bm && <div className="driver-note">Share of the current stress picture. Color shows how close each subsystem is to breaking; arrows show this week's direction.</div>}
        </div>

        <div className="panel">
          <div className="panel-title">What changed this week</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.whatChanged.length === 0 && <div className="panel-empty">Quiet week — no major moves.</div>}
          {bm && bm.whatChanged.map(row => {
            const c = row.direction === 'toward-danger' ? '#A32D2D' : row.direction === 'toward-safety' ? '#3B6D11' : 'var(--text-secondary)'
            return (
              <div className="change-row" key={row.key}>
                <div className="change-main">
                  <span className="change-label">{row.label}</span>
                  <span className="change-why">{row.why}</span>
                </div>
                <div className="change-vals" style={{ color: c }}>
                  {fmt(row.key, row.weekAgo)}{row.unit} <span style={{ opacity: 0.5 }}>→</span> <strong>{fmt(row.key, row.current)}{row.unit}</strong>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 7. Today's Situation ── */}
      <div className="ts-card">
        <div className="panel-title">Today&apos;s situation</div>
        {loading && <div className="panel-loading">Loading…</div>}
        {bm && (
          <>
            <div className="ts-headline" style={{ color }}>{bm.briefing.headline}</div>
            <div className="ts-grid">
              <div className="ts-cell">
                <div className="ts-k">Biggest concern</div>
                <div className="ts-v">{bm.briefing.concern ? <>{bm.briefing.concern.label}<span className="ts-detail"> — {bm.briefing.concern.detail}</span></> : 'Nothing pressing right now'}</div>
              </div>
              <div className="ts-cell">
                <div className="ts-k">Biggest stabilizer</div>
                <div className="ts-v">{bm.briefing.stabilizer ? <>{bm.briefing.stabilizer.label}<span className="ts-detail"> — calm</span></> : 'No standout'}</div>
              </div>
              <div className="ts-cell">
                <div className="ts-k">Watch next</div>
                <div className="ts-v">{nextEvent ? <>{nextEvent.name}<span className="ts-detail"> — {nextEvent.daysUntil === 0 ? 'today' : nextEvent.daysUntil === 1 ? 'tomorrow' : `in ${nextEvent.daysUntil}d`}</span></> : 'No major releases scheduled'}</div>
              </div>
            </div>
            {full && (
              <div className="ts-full-wrap">
                <button className="ts-toggle" onClick={() => setShowFull(s => !s)}>
                  {showFull ? 'Hide full analysis' : 'Read full analysis'} <span style={{ opacity: 0.6 }}>{showFull ? '▲' : '▼'}</span>
                </button>
                {showFull && <div className="ts-full">{full}</div>}
              </div>
            )}
          </>
        )}
      </div>

      <style>{ovStyles}</style>
    </div>
  )
}

const ovStyles = `
  .alerts-box { border-radius: 10px; padding: 1.1rem 1.25rem; margin-bottom: 1rem; border: 0.5px solid var(--border); background: var(--card-bg); }
  .alerts-box.is-alert { border-color: #E24B4A; background: var(--alert-bg); }
  .alerts-box.is-clear { border-color: #B8DCA0; }
  .alerts-head { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 500; color: var(--text-primary); }
  .alerts-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .alerts-dot.is-pulse { animation: ovpulse 1.6s ease-in-out infinite; }
  @keyframes ovpulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .alerts-clear-sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
  .alerts-concern-inline { font-size: 12px; color: var(--text-secondary); margin-top: 8px; }

  /* Rich alert card */
  .ac { border: 0.5px solid #E24B4A; border-left: 3px solid #E24B4A; background: var(--card-bg); border-radius: 10px; padding: 1.1rem 1.25rem; margin-bottom: 1rem; }
  .ac-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
  .ac-icon { font-size: 22px; line-height: 1; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--alert-bg); border-radius: 9px; flex-shrink: 0; }
  .ac-head-main { display: flex; flex-direction: column; gap: 2px; }
  .ac-title { font-size: 16px; font-weight: 500; color: var(--text-primary); }
  .ac-new { font-size: 11px; font-family: var(--mono); color: #A32D2D; display: flex; align-items: center; gap: 5px; }
  .ac-new-dot { width: 6px; height: 6px; border-radius: 50%; background: #E24B4A; animation: ovpulse 1.6s ease-in-out infinite; }
  .ac-body { display: grid; grid-template-columns: 160px 1fr 1fr 1fr; gap: 1.25rem; }
  @media (max-width: 860px) { .ac-body { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 560px) { .ac-body { grid-template-columns: 1fr; } }
  .ac-stats { display: flex; flex-direction: column; gap: 8px; }
  .ac-stat { display: flex; flex-direction: column; gap: 1px; }
  .ac-stat-k { font-size: 9px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); }
  .ac-stat-v { font-size: 14px; font-weight: 500; color: var(--text-primary); font-family: var(--mono); }
  .ac-col-h { font-size: 9px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 7px; }
  .ac-why { font-size: 12px; line-height: 1.55; color: var(--text-secondary); }
  .ac-areas { display: flex; flex-direction: column; gap: 7px; }
  .ac-area { display: flex; gap: 7px; align-items: baseline; }
  .ac-area-icon { font-size: 12px; flex-shrink: 0; }
  .ac-area-text { font-size: 11px; line-height: 1.45; color: var(--text-secondary); }
  .ac-area-text strong { color: var(--text-primary); font-weight: 500; }
  .ac-ctx { font-size: 11px; line-height: 1.5; color: var(--text-secondary); margin-bottom: 5px; padding-left: 10px; position: relative; }
  .ac-ctx::before { content: '·'; position: absolute; left: 2px; color: var(--text-muted); }
  .ac-view { margin-top: 6px; font-family: var(--mono); font-size: 11px; color: #A32D2D; background: none; border: 0.5px solid #E24B4A; border-radius: 6px; padding: 5px 10px; cursor: pointer; transition: background 0.15s; }
  .ac-view:hover { background: var(--alert-bg); }

  .bm-hero { display: flex; gap: 1.75rem; align-items: center; background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .bm-gauge { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 160px; }
  .bm-sev { font-size: 17px; font-weight: 500; letter-spacing: -0.01em; }
  .bm-label { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-top: 2px; }
  .bm-risks { font-size: 11px; color: var(--text-secondary); text-align: center; margin-top: 6px; max-width: 180px; }
  .bm-trend { flex: 1; min-width: 260px; }

  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
  @media (max-width: 640px) { .panels { grid-template-columns: 1fr; } .bm-hero { justify-content: center; } }
  .panel { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1.25rem; }
  .panel-title { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 12px; }
  .panel-loading, .panel-empty { font-size: 12px; color: var(--text-muted); font-family: var(--mono); padding: 0.5rem 0; }

  .rb-row { display: flex; align-items: center; gap: 9px; padding: 8px 0; border-bottom: 0.5px solid var(--border); }
  .rb-row:last-child { border-bottom: none; padding-bottom: 0; }
  .rb-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .rb-text { font-size: 13px; color: var(--text-primary); flex: 1; }
  .rb-ago { font-size: 11px; color: var(--text-muted); font-family: var(--mono); white-space: nowrap; }

  .wc-row { display: flex; align-items: center; gap: 9px; padding: 8px 0; border-bottom: 0.5px solid var(--border); }
  .wc-row:last-child { border-bottom: none; padding-bottom: 0; }
  .wc-icon { font-size: 13px; flex-shrink: 0; width: 18px; text-align: center; }
  .wc-label { font-size: 13px; color: var(--text-primary); flex: 1; }
  .wc-dist { font-size: 11px; color: var(--text-secondary); font-family: var(--mono); white-space: nowrap; }

  .change-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 0.5px solid var(--border); gap: 10px; }
  .change-row:last-child { border-bottom: none; padding-bottom: 0; }
  .change-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .change-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .change-why { font-size: 11px; color: var(--text-muted); }
  .change-vals { font-family: var(--mono); font-size: 12px; white-space: nowrap; }

  .driver-row { margin-bottom: 11px; }
  .driver-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 8px; }
  .driver-label { font-size: 12px; color: var(--text-secondary); }
  .driver-arrow { font-weight: 600; }
  .driver-sub { color: var(--text-muted); font-size: 11px; }
  .driver-pct { font-size: 12px; font-family: var(--mono); font-weight: 500; white-space: nowrap; }
  .driver-bar { height: 6px; background: var(--border-med); border-radius: 3px; overflow: hidden; }
  .driver-fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
  .driver-note { font-size: 10px; color: var(--text-muted); margin-top: 10px; line-height: 1.4; }

  .ts-card { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1.25rem; margin-bottom: 1rem; }
  .ts-headline { font-size: 16px; font-weight: 500; margin-bottom: 14px; }
  .ts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px 20px; }
  .ts-cell { display: flex; flex-direction: column; gap: 3px; }
  .ts-k { font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); }
  .ts-v { font-size: 13px; color: var(--text-primary); font-weight: 500; line-height: 1.4; }
  .ts-detail { color: var(--text-secondary); font-weight: 400; }
  .ts-full-wrap { margin-top: 14px; padding-top: 12px; border-top: 0.5px solid var(--border); }
  .ts-toggle { font-family: var(--mono); font-size: 11px; color: var(--text-secondary); background: none; border: none; cursor: pointer; padding: 0; }
  .ts-toggle:hover { color: var(--text-primary); }
  .ts-full { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin-top: 10px; max-width: 78ch; }

  .ov-unavail { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 2rem 1.5rem; text-align: center; }
  .ov-unavail-title { font-size: 14px; font-weight: 500; color: var(--text-primary); }
  .ov-unavail-sub { font-size: 12px; color: var(--text-muted); margin-top: 6px; max-width: 52ch; margin-left: auto; margin-right: auto; line-height: 1.5; }
`
