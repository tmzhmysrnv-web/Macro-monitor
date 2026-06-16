// components/Overview.tsx
// The Overview tab — an economic early-warning control room.
// Order answers the page's question fastest: Alerts → Break Meter → Recent
// Breaks → Watching → Drivers → What Changed → Today's Situation.
import { useEffect, useState } from 'react'
import Icon, { TAB_ICON, KEY_ICON } from './Icon'
import type { MacroData } from '../lib/fetchData'
import trendSnapshot from '../data/trendSnapshot.json'

// Deep Break Meter history is immutable — bundled as a static snapshot so it
// renders instantly and never depends on a live, throttle-prone backfill.
const DEEP_TREND = trendSnapshot.history as { date: string; value: number }[]

type Driver = { key: string; label: string; stress: number; status: string; driver: string; driverKey: string; trend: 'up' | 'down' | 'flat'; share: number }
type ChangeRow = { key: string; label: string; why: string; current: number; weekAgo: number; unit: string; direction: string; significance: number }
type Alert = { key: string; label: string; message: string }
type WatchItem = { key: string; label: string; text: string; heat: 'hot' | 'near'; why: string; category: { tab: string; label: string } | null }
type BreakEvent = { key: string; text: string; why: string; tone: 'bad' | 'good'; date: string; daysAgo: number }
type Briefing = { headline: string; concern: { label: string; detail: string; tab: string } | null; stabilizer: { label: string; detail: string; tab: string } | null }
type EventItem = { name: string; date: string; daysUntil: number; description: string; metricKey?: string }
type BreakMeter = {
  available: boolean
  total: number; level: string; verdict: string
  drivers: Driver[]
  whatChanged: ChangeRow[]
  alerts: Alert[]
  watching: WatchItem[]
  recentBreaks: BreakEvent[]
  briefing: Briefing
  directions?: Record<string, 'up' | 'down' | 'flat'>
  recentTrend?: { date: string; value: number }[]
  weekChange?: number | null
  concern: { label: string; detail: string; tab: string } | null
}

const CAT_COLORS: Record<string, string> = {
  calm: '#8AB84A', watch: '#A9C24E', elevated: '#D88B2F', stressed: '#E07A4A', breaking: '#EF6B5E',
}

// Spec severity scale — drives the prominent status label and the legend.
const SEVERITY_BANDS = [
  { lo: 0, hi: 20, label: 'Healthy', color: '#8AB84A' },
  { lo: 21, hi: 40, label: 'Worth Watching', color: '#A9C24E' },
  { lo: 41, hi: 60, label: 'Elevated', color: '#D88B2F' },
  { lo: 61, hi: 80, label: 'High Risk', color: '#E07A4A' },
  { lo: 81, hi: 100, label: 'Breaking', color: '#EF6B5E' },
]
function severity(total: number): { label: string; color: string } {
  const b = SEVERITY_BANDS.find(b => total >= b.lo && total <= b.hi) ?? SEVERITY_BANDS[0]
  return { label: b.label, color: b.color }
}

// Short labels for the clickable Recent Breaks rows → metric-card modal title
const RB_LABEL: Record<string, string> = {
  mortgage30: '30Y Mortgage', treasury10y: '10Y Treasury', cpi: 'CPI (YoY)', vix: 'VIX',
  oil: 'WTI Crude', hySpread: 'HY Bond Spread', igSpread: 'IG Credit Spread',
  joblessClaims: 'Jobless Claims', yieldCurve: '2Y–10Y Spread',
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

export default function Overview({ data = null, events = [], onViewCard, onNavigate, onOpenAlerts, activeCount = 0 }: { data?: MacroData | null; events?: EventItem[]; onViewCard?: (key: string, label: string) => void; onNavigate?: (tab: string) => void; onOpenAlerts?: () => void; activeCount?: number }) {
  const [bm, setBm] = useState<BreakMeter | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fast: score + alerts + drivers + the fresh trailing-year trend.
    fetch('/api/breakmeter')
      .then(r => r.json())
      .then(d => { setBm(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Shared "past 7 days" delta, reconstructed server-side — same for everyone.
  const delta = bm?.weekChange ?? null

  const sev = bm ? severity(bm.total) : { label: '', color: '#8AB84A' }
  const color = sev.color
  const dataReady = data != null
  const primaryRisks = (bm?.drivers ?? []).filter(d => d.stress >= 25).slice(0, 2).map(d => d.label)
  const nextEvent = events.length ? [...events].sort((a, b) => a.daysUntil - b.daysUntil)[0] : null
  // Split the recent-event feed by tone: red breaks vs. green "recently cleared".
  const breaks = (bm?.recentBreaks ?? []).filter(e => e.tone === 'bad')
  const cleared = (bm?.recentBreaks ?? []).filter(e => e.tone === 'good')

  // Stitch the trend: immutable deep snapshot → fresh trailing year (recomputed
  // live, no extra fetch) → today's live reading. The deep history renders
  // instantly; the recent part sharpens once the meter loads.
  const today = new Date().toISOString().split('T')[0]
  const recent = bm?.recentTrend ?? []
  const cutoff = recent.length ? recent[0].date : null
  const base = cutoff ? [...DEEP_TREND.filter(p => p.date < cutoff), ...recent] : DEEP_TREND
  const trendLine = bm
    ? [...base.filter(p => p.date.slice(0, 7) !== today.slice(0, 7)), { date: today, value: bm.total }]
    : base

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
      {/* ── 1. Active Alerts → opens the alert monitor (the cracked-bell drawer) ── */}
      <div className={`alerts-box ${activeCount ? 'is-alert' : 'is-clear'}`}>
        <div
          className={`alerts-head ${activeCount ? 'is-toggle' : ''}`}
          onClick={activeCount ? onOpenAlerts : undefined}
          role={activeCount ? 'button' : undefined}
          tabIndex={activeCount ? 0 : undefined}
          onKeyDown={activeCount ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenAlerts?.() } } : undefined}
        >
          <span className={`alerts-dot ${activeCount ? 'is-pulse' : ''}`} style={{ background: activeCount ? 'var(--bad)' : 'var(--good)' }} />
          <span className="alerts-head-text">
            {!dataReady ? 'Checking alerts…'
              : activeCount ? `${activeCount} Active Alert${activeCount > 1 ? 's' : ''}`
              : 'No Active Alerts'}
          </span>
          {activeCount > 0 && <span className="alerts-chevron">View →</span>}
        </div>
        {dataReady && activeCount === 0 && (
          <div className="alerts-clear-sub">Nothing important is currently breaking.</div>
        )}
        {dataReady && activeCount > 0 && bm?.concern && (
          <div className="alerts-concern-inline">
            Most significant concern: <strong>{bm.concern.label}</strong>{bm.concern.detail ? ` · ${bm.concern.detail}` : ''}
          </div>
        )}
      </div>

      {/* ── 2. Break Meter ── */}
      <div className="bm-hero" style={{ borderLeft: `3px solid ${color}`, borderRadius: '0 10px 10px 0' }}>
        <div className="bm-gauge">
          <svg width="160" height="96" viewBox="0 0 160 96">
            <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}`} fill="none" stroke="var(--border-med)" strokeWidth="9" strokeLinecap="round" />
            {bm && <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />}
            <text x={CX} y={CY-4} textAnchor="middle" fontSize="26" fontWeight="500" fontFamily="var(--mono)" fill="var(--text-primary)">{bm ? bm.total : '—'}</text>
            <text x={CX} y={CY+11} textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-muted)">/ 100</text>
          </svg>
          <div className="bm-sev" style={{ color }}>{sev.label}</div>
          <div className="bm-label">Break Meter</div>
          {bm && delta != null && (
            delta === 0
              ? <div className="bm-delta bm-delta-flat">No change this week</div>
              : <div className="bm-delta" style={{ color: delta > 0 ? 'var(--bad)' : 'var(--good)' }}>
                  {delta > 0 ? '↑' : '↓'} {delta > 0 ? '+' : '−'}{Math.abs(delta)} in the past week
                </div>
          )}
          {primaryRisks.length > 0 && (
            <div className="bm-risks">Primary risks: {primaryRisks.join(', ')}</div>
          )}
          {bm && (
            <div className="bm-scale" aria-label="Severity scale">
              {SEVERITY_BANDS.map(b => {
                const active = bm.total >= b.lo && bm.total <= b.hi
                return (
                  <div className={`bm-scale-row ${active ? 'is-active' : ''}`} key={b.label}>
                    <span className="bm-scale-dot" style={{ background: b.color }} />
                    <span className="bm-scale-range">{b.lo}–{b.hi}</span>
                    <span className="bm-scale-label">{b.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="bm-trend">
          <BreakMeterTrend history={trendLine} color={color} />
        </div>
      </div>

      {/* ── 3. Current situation — plain-language context, right under the meter ── */}
      <div className="ts-card" style={bm ? { borderLeft: `3px solid ${color}`, borderRadius: '0 10px 10px 0' } : undefined}>
        <div className="panel-title">Current situation</div>
        {loading && <div className="panel-loading">Loading…</div>}
        {bm && (
          <>
            <div className="ts-headline" style={{ color }}>{bm.briefing.headline}</div>
            <div className="ts-grid">
              {(() => {
                const concern = bm.briefing.concern
                const cNav = onNavigate && concern ? () => onNavigate(concern.tab) : undefined
                return (
                  <div className={`ts-cell ${cNav ? 'is-click' : ''}`} onClick={cNav} role={cNav ? 'button' : undefined} tabIndex={cNav ? 0 : undefined} onKeyDown={cNav ? (e) => { if (e.key === 'Enter') cNav() } : undefined}>
                    <div className="ts-k">Biggest concern</div>
                    <div className="ts-v">{concern ? <>{concern.label}<span className="ts-detail"> — {concern.detail}</span>{cNav && <span className="ts-go"> →</span>}</> : 'Nothing pressing right now'}</div>
                  </div>
                )
              })()}
              {(() => {
                const stab = bm.briefing.stabilizer
                const sNav = onNavigate && stab ? () => onNavigate(stab.tab) : undefined
                return (
                  <div className={`ts-cell ${sNav ? 'is-click' : ''}`} onClick={sNav} role={sNav ? 'button' : undefined} tabIndex={sNav ? 0 : undefined} onKeyDown={sNav ? (e) => { if (e.key === 'Enter') sNav() } : undefined}>
                    <div className="ts-k">Biggest stabilizer</div>
                    <div className="ts-v">{stab ? <>{stab.label}<span className="ts-detail"> — calm</span>{sNav && <span className="ts-go"> →</span>}</> : 'No standout'}</div>
                  </div>
                )
              })()}
              {(() => {
                const wNav = onViewCard && nextEvent?.metricKey ? () => onViewCard(nextEvent.metricKey!, nextEvent.name) : undefined
                return (
                  <div className={`ts-cell ${wNav ? 'is-click' : ''}`} onClick={wNav} role={wNav ? 'button' : undefined} tabIndex={wNav ? 0 : undefined} onKeyDown={wNav ? (e) => { if (e.key === 'Enter') wNav() } : undefined}>
                    <div className="ts-k">Watch next</div>
                    <div className="ts-v">{nextEvent ? <>{nextEvent.name}<span className="ts-detail"> — {nextEvent.daysUntil === 0 ? 'today' : nextEvent.daysUntil === 1 ? 'tomorrow' : `in ${nextEvent.daysUntil}d`}</span>{wNav && <span className="ts-go"> ↗</span>}</> : 'No major releases scheduled'}</div>
                  </div>
                )
              })()}
            </div>
          </>
        )}
      </div>

      {/* ── 4. Recent breaks · Recently cleared ── */}
      <div className="panels">
        <div className="panel edge-bad">
          <div className="panel-title">Recent breaks</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && breaks.length === 0 && <div className="panel-empty">No notable thresholds crossed recently.</div>}
          {bm && breaks.map((e, i) => (
            <div
              className={`rb-row ${onViewCard ? 'is-click' : ''}`}
              key={i}
              onClick={onViewCard ? () => onViewCard(e.key, RB_LABEL[e.key] ?? e.key) : undefined}
              role={onViewCard ? 'button' : undefined}
              tabIndex={onViewCard ? 0 : undefined}
              onKeyDown={onViewCard ? (ev) => { if (ev.key === 'Enter') onViewCard(e.key, RB_LABEL[e.key] ?? e.key) } : undefined}
            >
              <span className="rb-ic" style={{ color: 'var(--bad)' }}><Icon name={KEY_ICON[e.key] || 'alert-circle'} size={15} /></span>
              <div className="rb-main">
                <div className="rb-top">
                  <span className="rb-text">{e.text}</span>
                  <span className="rb-ago">{e.daysAgo <= 0 ? 'today' : e.daysAgo === 1 ? '1d ago' : `${e.daysAgo}d ago`}</span>
                  {onViewCard && <span className="rb-go">↗</span>}
                </div>
                {e.why && <div className="rb-why">{e.why}</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="panel edge-good">
          <div className="panel-title">Recently cleared</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && cleared.length === 0 && <div className="panel-empty">Nothing has cleared recently.</div>}
          {bm && cleared.map((e, i) => (
            <div
              className={`rb-row ${onViewCard ? 'is-click' : ''}`}
              key={i}
              onClick={onViewCard ? () => onViewCard(e.key, RB_LABEL[e.key] ?? e.key) : undefined}
              role={onViewCard ? 'button' : undefined}
              tabIndex={onViewCard ? 0 : undefined}
              onKeyDown={onViewCard ? (ev) => { if (ev.key === 'Enter') onViewCard(e.key, RB_LABEL[e.key] ?? e.key) } : undefined}
            >
              <span className="rb-ic" style={{ color: 'var(--good)' }}><Icon name={KEY_ICON[e.key] || 'circle-check'} size={15} /></span>
              <div className="rb-main">
                <div className="rb-top">
                  <span className="rb-text">{e.text}</span>
                  <span className="rb-ago">{e.daysAgo <= 0 ? 'today' : e.daysAgo === 1 ? '1d ago' : `${e.daysAgo}d ago`}</span>
                  {onViewCard && <span className="rb-go">↗</span>}
                </div>
                {e.why && <div className="rb-why">{e.why}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5. Drivers · What Changed ── */}
      <div className="panels">
        <div className="panel">
          <div className="panel-title">Drivers of the Break Meter</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.drivers.map(d => {
            const arrow = d.trend === 'up' ? '↑' : d.trend === 'down' ? '↓' : ''
            const arrowColor = d.trend === 'up' ? 'var(--bad)' : d.trend === 'down' ? 'var(--good)' : 'var(--text-muted)'
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
          {bm && <div className="driver-note">Share of the current stress picture. Color shows how close each subsystem is to breaking; arrows mark subsystems that moved over the past week (no arrow = unchanged).</div>}
        </div>

        <div className="panel">
          <div className="panel-title">What changed this week</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.whatChanged.length === 0 && <div className="panel-empty">Quiet week — no major moves.</div>}
          {bm && bm.whatChanged.map(row => {
            // Color reflects meaning, not sign: toward-danger = red, toward-safety = green.
            const c = row.direction === 'toward-danger' ? 'var(--bad)' : row.direction === 'toward-safety' ? 'var(--good)' : 'var(--text-muted)'
            const base = Math.abs(row.weekAgo) > 1e-6 ? Math.abs(row.weekAgo) : null
            const pct = base ? ((row.current - row.weekAgo) / base) * 100 : null
            const absPct = pct == null ? null : Math.abs(pct)
            const pctStr = absPct == null ? '—' : `${absPct >= 100 ? absPct.toFixed(0) : absPct.toFixed(1)}%`
            const arrow = row.current > row.weekAgo ? '↑' : row.current < row.weekAgo ? '↓' : ''
            return (
              <div
                className={`change-row ${onViewCard ? 'is-click' : ''}`}
                key={row.key}
                onClick={onViewCard ? () => onViewCard(row.key, row.label) : undefined}
                role={onViewCard ? 'button' : undefined}
                tabIndex={onViewCard ? 0 : undefined}
                onKeyDown={onViewCard ? (ev) => { if (ev.key === 'Enter') onViewCard(row.key, row.label) } : undefined}
              >
                <div className="change-main">
                  <span className="change-label">{row.label}</span>
                  <span className="change-why">{row.why}</span>
                </div>
                <div className="change-vals">
                  {fmt(row.key, row.weekAgo)} <span style={{ opacity: 0.5 }}>→</span> {fmt(row.key, row.current)}
                </div>
                <div className="change-pct" style={{ color: c }}>
                  {arrow && <span className="change-arrow">{arrow}</span>}{pctStr}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 6. Watching closely — forward-looking, sits just above the calendar ── */}
      <div className="panel edge-warn wc-solo">
        <div className="panel-title">Watching closely</div>
        {loading && <div className="panel-loading">Loading…</div>}
        {bm && bm.watching.length === 0 && <div className="panel-empty">Nothing close to an alert threshold.</div>}
        {bm && bm.watching.map(w => {
          const nav = onNavigate && w.category ? () => onNavigate(w.category!.tab) : undefined
          return (
            <div
              className={`wc-row ${nav ? 'is-click' : ''}`}
              key={w.key}
              onClick={nav}
              role={nav ? 'button' : undefined}
              tabIndex={nav ? 0 : undefined}
              onKeyDown={nav ? (ev) => { if (ev.key === 'Enter') nav() } : undefined}
            >
              <span className="wc-icon" style={{ color: w.heat === 'hot' ? 'var(--bad)' : 'var(--warn)' }}>
                <Icon name={(w.category && TAB_ICON[w.category.tab]) || (w.heat === 'hot' ? 'flame' : 'alert-triangle')} size={15} />
              </span>
              <div className="wc-main">
                <div className="wc-top">
                  <span className="wc-label">{w.label}</span>
                  <span className="wc-dist">{w.text}</span>
                </div>
                <div className="wc-sub">
                  {w.category && <span className="wc-cat">{w.category.label}</span>}
                  {w.why && <span className="wc-why">{w.why}</span>}
                  {nav && <span className="wc-go">→</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <style>{ovStyles}</style>
    </div>
  )
}

const ovStyles = `
  .alerts-box { border-radius: 10px; padding: 1.1rem 1.25rem; margin-bottom: 1rem; border: 0.5px solid var(--border); background: var(--card-bg); }
  .alerts-box.is-alert { border-color: var(--bad); border-left: 3px solid var(--bad); border-radius: 0 10px 10px 0; background: var(--alert-bg); }
  .alerts-box.is-clear { border-left: 3px solid var(--good); border-radius: 0 10px 10px 0; }

  /* Signature status edge — colored left border keyed to tone (matches the email + alerts drawer) */
  /* Scoped to .panel so they outrank .panel's own border shorthand (which is
     defined later and would otherwise wipe the colored left edge). */
  .panel.edge-bad { border-left: 3px solid var(--bad); border-radius: 0 10px 10px 0; }
  .panel.edge-good { border-left: 3px solid var(--good); border-radius: 0 10px 10px 0; }
  .panel.edge-warn { border-left: 3px solid var(--warn); border-radius: 0 10px 10px 0; }
  .wc-solo { margin-bottom: 1rem; }
  .alerts-head { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 500; color: var(--text-primary); }
  .alerts-head.is-toggle { cursor: pointer; user-select: none; }
  .alerts-head-text { flex: 1; }
  .alerts-chevron { font-size: 11px; font-weight: 500; font-family: var(--mono); color: var(--text-muted); letter-spacing: 0.02em; }
  .alerts-head.is-toggle:hover .alerts-chevron { color: var(--text-secondary); }
  .alerts-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .alerts-dot.is-pulse { animation: ovpulse 1.6s ease-in-out infinite; }
  @keyframes ovpulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .alerts-clear-sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
  .alerts-concern-inline { font-size: 12px; color: var(--text-secondary); margin-top: 8px; }

  .bm-hero { display: flex; gap: 1.75rem; align-items: center; background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .bm-gauge { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 160px; }
  .bm-sev { font-size: 17px; font-weight: 500; letter-spacing: -0.01em; }
  .bm-delta { font-size: 11px; font-weight: 500; font-family: var(--mono); margin-top: 3px; }
  .bm-delta-flat { color: var(--text-muted); font-weight: 400; }
  .bm-label { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-top: 2px; }
  .bm-risks { font-size: 11px; color: var(--text-secondary); text-align: center; margin-top: 6px; max-width: 200px; }
  /* Severity legend under the gauge */
  .bm-scale { margin-top: 12px; display: flex; flex-direction: column; gap: 2px; width: 100%; max-width: 200px; }
  .bm-scale-row { display: flex; align-items: center; gap: 7px; padding: 2px 6px; border-radius: 5px; opacity: 0.5; }
  .bm-scale-row.is-active { opacity: 1; background: var(--border); }
  .bm-scale-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .bm-scale-range { font-size: 10px; font-family: var(--mono); color: var(--text-muted); width: 42px; }
  .bm-scale-label { font-size: 11px; color: var(--text-secondary); }
  .bm-scale-row.is-active .bm-scale-label { color: var(--text-primary); font-weight: 500; }
  /* The trend is context, not a focal point — keep it modest, not full-bleed */
  .bm-trend { flex: 1 1 320px; min-width: 240px; }

  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
  @media (max-width: 640px) { .panels { grid-template-columns: 1fr; } .bm-hero { justify-content: center; } }
  .panel { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1.25rem; }
  .panel-title { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 12px; }
  .panel-loading, .panel-empty { font-size: 12px; color: var(--text-muted); font-family: var(--mono); padding: 0.5rem 0; }

  .rb-row { display: flex; align-items: flex-start; gap: 9px; padding: 8px 0; border-bottom: 0.5px solid var(--border); }
  .rb-row:last-child { border-bottom: none; padding-bottom: 0; }
  .rb-row.is-click { cursor: pointer; margin: 0 -6px; padding: 8px 6px; border-radius: 6px; transition: background 0.12s; }
  .rb-row.is-click:hover { background: var(--border); }
  .rb-ic { flex-shrink: 0; display: flex; align-items: center; margin-top: 1px; }
  .rb-main { flex: 1; min-width: 0; }
  .rb-top { display: flex; align-items: baseline; gap: 9px; }
  .rb-text { font-size: 13px; color: var(--text-primary); flex: 1; }
  .rb-ago { font-size: 11px; color: var(--text-muted); font-family: var(--mono); white-space: nowrap; }
  .rb-go { font-size: 11px; color: var(--text-muted); opacity: 0; transition: opacity 0.12s; }
  .rb-row.is-click:hover .rb-go { opacity: 1; }
  .rb-why { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

  .wc-row { display: flex; align-items: flex-start; gap: 9px; padding: 8px 0; border-bottom: 0.5px solid var(--border); }
  .wc-row:last-child { border-bottom: none; padding-bottom: 0; }
  .wc-row.is-click { cursor: pointer; margin: 0 -6px; padding: 8px 6px; border-radius: 6px; transition: background 0.12s; }
  .wc-row.is-click:hover { background: var(--border); }
  .wc-icon { flex-shrink: 0; width: 18px; display: flex; justify-content: center; margin-top: 1px; }
  .wc-main { flex: 1; min-width: 0; }
  .wc-top { display: flex; align-items: baseline; gap: 9px; }
  .wc-label { font-size: 13px; color: var(--text-primary); flex: 1; }
  .wc-dist { font-size: 11px; color: var(--text-secondary); font-family: var(--mono); white-space: nowrap; }
  .wc-sub { display: flex; align-items: baseline; gap: 7px; margin-top: 3px; flex-wrap: wrap; }
  .wc-cat { font-size: 9px; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; font-family: var(--mono); color: var(--text-secondary); background: var(--border); padding: 1px 6px; border-radius: 4px; flex-shrink: 0; }
  .wc-why { font-size: 11px; color: var(--text-muted); flex: 1; min-width: 0; }
  .wc-go { font-size: 11px; color: var(--text-muted); opacity: 0; transition: opacity 0.12s; }
  .wc-row.is-click:hover .wc-go { opacity: 1; }

  /* label (what changed) | the change (middle) | % — middle col is auto so it
     never overflows into the label/% columns */
  .change-row { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(54px,1fr); align-items: center; padding: 9px 0; border-bottom: 0.5px solid var(--border); gap: 14px; }
  .change-row:last-child { border-bottom: none; padding-bottom: 0; }
  .change-row.is-click { cursor: pointer; margin: 0 -6px; padding: 9px 6px; border-radius: 6px; transition: background 0.12s; }
  .change-row.is-click:hover { background: var(--border); }
  .change-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .change-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .change-why { font-size: 11px; color: var(--text-muted); }
  .change-vals { font-family: var(--mono); font-size: 11px; color: var(--text-muted); white-space: nowrap; text-align: center; }
  .change-pct { font-family: var(--mono); font-size: 13px; font-weight: 500; white-space: nowrap; text-align: right; }
  .change-arrow { margin-right: 2px; }

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
  .ts-cell.is-click { cursor: pointer; margin: -4px -8px; padding: 4px 8px; border-radius: 6px; transition: background 0.12s; }
  .ts-cell.is-click:hover { background: var(--border); }
  .ts-k { font-size: 10px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); }
  .ts-v { font-size: 13px; color: var(--text-primary); font-weight: 500; line-height: 1.4; }
  .ts-detail { color: var(--text-secondary); font-weight: 400; }
  .ts-go { color: var(--text-muted); opacity: 0; transition: opacity 0.12s; font-family: var(--mono); }
  .ts-cell.is-click:hover .ts-go { opacity: 1; }
  .ts-full-wrap { margin-top: 14px; padding-top: 12px; border-top: 0.5px solid var(--border); }
  .ts-toggle { font-family: var(--mono); font-size: 11px; color: var(--text-secondary); background: none; border: none; cursor: pointer; padding: 0; }
  .ts-toggle:hover { color: var(--text-primary); }
  .ts-full { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin-top: 10px; max-width: 78ch; }

  .ov-unavail { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 2rem 1.5rem; text-align: center; }
  .ov-unavail-title { font-size: 14px; font-weight: 500; color: var(--text-primary); }
  .ov-unavail-sub { font-size: 12px; color: var(--text-muted); margin-top: 6px; max-width: 52ch; margin-left: auto; margin-right: auto; line-height: 1.5; }
`
