// pages/index.tsx — Is the World Breaking?
import { useEffect, useState, useCallback } from 'react'
import Head from 'next/head'
import type { MacroData } from '../lib/fetchData'
import { INDICATORS, getStatus, getPercentile, getContextText, getOpportunityText, type AlertStatus, type Indicator } from '../lib/thresholds'
import type { DataPoint } from '../lib/fetchHistory'
import Overview from '../components/Overview'
import Housing from '../components/Housing'
import Bonds from '../components/Bonds'
import Credit from '../components/Credit'
import Inflation from '../components/Inflation'
import Labor from '../components/Labor'
import Markets from '../components/Markets'
import Global from '../components/Global'
import NotificationPanel, { type PanelAlert } from '../components/NotificationPanel'
import { severityOf } from '../lib/alertSeverity'
import { barFor } from '../lib/alertMeta'

// Client-side notification history (localStorage). Lets the bell show active
// alerts instantly on reload and keep cleared ones as "Earlier", independent of
// the ~600ms tab prefetch and the daily cron feed. Also accumulates each alert's
// value over time (triggerValue / peak / track) to power the monitor trajectory.
type AlertHistoryItem = PanelAlert & { firstSeen: number; lastSeen: number; cleared: boolean }
const ALERT_HISTORY_KEY = 'mm_alert_history'
const ALERTS_SEEN_KEY = 'mm_alerts_seen_at'

function getValueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper, silver: data.silver,
    mortgage30: data.mortgage30, treasury2y: data.treasury2y, payrolls: data.payrolls, homePriceYoY: data.homePriceYoY,
  }
  return map[key] ?? null
}

function getChangeForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    sp500: data.sp500Change, dxy: data.dxyChange, gold: data.goldChange,
    oil: data.oilChange, copper: data.copperChange, silver: data.silverChange, vix: null,
  }
  return map[key] ?? null
}

function formatValue(key: string, value: number | null): string {
  if (value == null) return '—'
  if (key === 'sp500') return value.toLocaleString('en-US')
  if (key === 'gold') return `$${value.toLocaleString('en-US')}`
  if (key === 'oil') return `$${value.toFixed(2)}`
  if (key === 'copper') return `$${value.toFixed(3)}`
  if (key === 'silver') return `$${value.toFixed(2)}`
  if (key === 'dxy') return value.toFixed(2)
  if (key === 'joblessClaims') return `${value.toFixed(0)}k`
  if (key === 'yieldCurve') return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  if (key === 'payrolls') return `${value > 0 ? '+' : ''}${Math.round(value)}k`
  if (key === 'homePriceYoY') return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
  if (['treasury10y', 'treasury2y', 'fedfunds', 'cpi', 'hySpread', 'igSpread', 'mortgage30'].includes(key)) return `${value.toFixed(2)}%`
  return value.toFixed(1)
}

// One-line "what the release came in at" for a past calendar event.
function outcomeLine(ind: Indicator, value: number): string {
  const status = getStatus(ind, value)
  const note = status === 'alert'
    ? `above its ${ind.alertAbove ?? ind.alertBelow}${ind.unit} alert`
    : status === 'warn' ? 'near its alert threshold' : 'within its normal range'
  return `${ind.label} now ${formatValue(ind.key, value)} — ${note}`
}

// Non-farm payrolls outcome — vs the recent monthly pace (no free consensus source).
function jobsOutcome(payrolls: number, avg: number | null): string {
  const headline = `${payrolls >= 0 ? '+' : ''}${payrolls}k jobs`
  if (avg == null) return `${headline} added`
  const cmp = payrolls >= avg + 25 ? `above the recent ~${avg}k/mo pace`
    : payrolls <= avg - 25 ? `below the recent ~${avg}k/mo pace`
    : `about the recent ~${avg}k/mo pace`
  return `${headline} added — ${cmp}`
}

const STATUS_STYLES: Record<AlertStatus, { dot: string; value: string; border: string; bg: string; note: string }> = {
  ok:    { dot: 'var(--good)', value: 'inherit',      border: 'var(--border)', bg: 'var(--card-bg)',  note: 'var(--text-muted)' },
  warn:  { dot: 'var(--warn)', value: 'var(--warn)',  border: 'var(--warn)',   bg: 'var(--warn-bg)',  note: 'var(--warn)' },
  alert: { dot: 'var(--bad)',  value: 'var(--bad)',   border: 'var(--bad)',    bg: 'var(--alert-bg)', note: 'var(--bad)' },
}

const SECTIONS = [
  { label: 'Volatility & Risk',    keys: ['vix', 'hySpread', 'igSpread'] },
  { label: 'Rates & Housing',      keys: ['treasury10y', 'treasury2y', 'fedfunds', 'yieldCurve', 'mortgage30', 'homePriceYoY'] },
  { label: 'Inflation & Labor',    keys: ['cpi', 'joblessClaims', 'payrolls'] },
  { label: 'Dollar & Commodities', keys: ['dxy', 'gold', 'silver', 'oil', 'copper'] },
  { label: 'Markets',              keys: ['sp500'] },
]

// Tab definitions — Overview is special; the rest filter the card sections
const TABS: { id: string; label: string; sections?: typeof SECTIONS }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'bonds',     label: 'Bonds' },   // renders the <Bonds /> intelligence model, not indicator cards
  { id: 'housing',   label: 'Housing' }, // renders the <Housing /> status model, not indicator cards
  { id: 'credit',    label: 'Credit' },  // renders the <Credit /> intelligence model, not indicator cards
  { id: 'inflation', label: 'Inflation' }, // renders the <Inflation /> intelligence model, not indicator cards
  { id: 'labor',     label: 'Labor' },   // renders the <Labor /> intelligence model, not indicator cards
  { id: 'markets',   label: 'Markets' }, // renders the <Markets /> intelligence model, not indicator cards
  { id: 'global',    label: 'Global' },  // renders the <Global /> intelligence model, not indicator cards
  { id: 'all',       label: 'All Data',  sections: SECTIONS },
]

// ── Mini sparkline SVG ────────────────────────────────────────────────
function Sparkline({ series, status }: { series: DataPoint[]; status: AlertStatus }) {
  if (!series || series.length < 2) return null
  const W = 80, H = 28
  const vals = series.map(d => d.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const pts = series.map((d, i) => {
    const x = (i / (series.length - 1)) * W
    const y = H - ((d.value - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const color = status === 'alert' ? '#E24B4A' : status === 'warn' ? '#BA7517' : '#639922'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', opacity: 0.7 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Historical chart modal ────────────────────────────────────────────
function HistoryModal({ indicatorKey, label, onClose }: { indicatorKey: string; label: string; onClose: () => void }) {
  const [series, setSeries] = useState<DataPoint[] | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/history?key=${indicatorKey}`)
      .then(r => r.json())
      .then(d => { setSeries(d.series); setLoading(false) })
      .catch(() => setLoading(false))
  }, [indicatorKey])

  const W = 560, H = 200, PAD = { top: 16, right: 16, bottom: 32, left: 48 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const chartData = series && series.length > 1 ? series : null
  const vals = chartData ? chartData.map(d => d.value) : []
  const min = vals.length ? Math.min(...vals) : 0
  const max = vals.length ? Math.max(...vals) : 1
  const range = max - min || 1

  const toX = (i: number) => PAD.left + (i / (vals.length - 1)) * innerW
  const toY = (v: number) => PAD.top + innerH - ((v - min) / range) * innerH

  const points = chartData ? chartData.map((d, i) => `${toX(i).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ') : ''

  // Year labels
  const yearLabels: { x: number; year: string }[] = []
  if (chartData) {
    let lastYear = ''
    chartData.forEach((d, i) => {
      const y = d.date.slice(0, 4)
      if (y !== lastYear) { yearLabels.push({ x: toX(i), year: y }); lastYear = y }
    })
  }

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: PAD.top + innerH * (1 - t),
    label: (min + range * t).toFixed(range > 100 ? 0 : range > 10 ? 1 : 2),
  }))

  const hovered = hoverIdx != null && chartData ? chartData[hoverIdx] : null

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!chartData) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width)
    const relX = mx - PAD.left
    const idx = Math.round((relX / innerW) * (chartData.length - 1))
    setHoverIdx(Math.max(0, Math.min(chartData.length - 1, idx)))
  }

  const indicator = INDICATORS.find(i => i.key === indicatorKey)
  const hoverStatus = hovered && indicator ? getStatus(indicator, hovered.value) : 'ok'
  const dotColor = STATUS_STYLES[hoverStatus].dot

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div style={{ background: 'var(--card-bg)', border: '0.5px solid var(--border-med)', borderRadius: '12px', padding: '1.5rem', maxWidth: '620px', width: '100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '2px' }}>{label} — 20-year history</div>
            {hovered ? (
              <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span style={{ color: dotColor, fontWeight: 500 }}>{formatValue(indicatorKey, hovered.value)}</span>
                <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>{hovered.date}</span>
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Hover to explore</div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: 'var(--text-muted)', lineHeight: 1, padding: '0 0 0 12px' }}>×</button>
        </div>

        {loading && <div style={{ height: `${H}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px', fontFamily: 'var(--mono)' }}>Loading…</div>}

        {!loading && !chartData && <div style={{ height: `${H}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>No historical data available</div>}

        {!loading && chartData && (
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', cursor: 'crosshair', overflow: 'visible' }}
            onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
            {/* Grid lines */}
            {yTicks.map((t, i) => (
              <g key={i}>
                <line x1={PAD.left} y1={t.y} x2={PAD.left + innerW} y2={t.y} stroke="var(--border)" strokeWidth="0.5" />
                <text x={PAD.left - 6} y={t.y + 4} textAnchor="end" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">{t.label}</text>
              </g>
            ))}
            {/* Alert threshold line */}
            {indicator?.alertAbove != null && indicator.alertAbove >= min && indicator.alertAbove <= max && (
              <line x1={PAD.left} y1={toY(indicator.alertAbove)} x2={PAD.left + innerW} y2={toY(indicator.alertAbove)}
                stroke="#E24B4A" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />
            )}
            {indicator?.alertBelow != null && indicator.alertBelow >= min && indicator.alertBelow <= max && (
              <line x1={PAD.left} y1={toY(indicator.alertBelow)} x2={PAD.left + innerW} y2={toY(indicator.alertBelow)}
                stroke="#E24B4A" strokeWidth="1" strokeDasharray="4,3" opacity="0.6" />
            )}
            {/* Year labels */}
            {yearLabels.filter((_, i) => i % 2 === 0).map((yl, i) => (
              <text key={i} x={yl.x} y={PAD.top + innerH + 20} textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="monospace">{yl.year}</text>
            ))}
            {/* Main line */}
            <polyline points={points} fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            {/* Hover crosshair */}
            {hoverIdx != null && chartData[hoverIdx] && (() => {
              const x = toX(hoverIdx), y = toY(chartData[hoverIdx].value)
              return (
                <g>
                  <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + innerH} stroke="var(--text-muted)" strokeWidth="0.5" />
                  <circle cx={x} cy={y} r="4" fill={dotColor} stroke="var(--card-bg)" strokeWidth="2" />
                </g>
              )
            })()}
          </svg>
        )}

        {/* Annotated periods */}
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {[
            { label: '2008 GFC', color: '#E24B4A' },
            { label: '2020 COVID', color: '#BA7517' },
            { label: '2022 Rate Hikes', color: '#BA7517' },
          ].map(p => (
            <span key={p.label} style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ display: 'inline-block', width: '20px', height: '1px', background: p.color, borderTop: `1px dashed ${p.color}` }} />
              {p.label}
            </span>
          ))}
          {indicator?.alertAbove != null && (
            <span style={{ fontSize: '10px', color: '#E24B4A', fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ display: 'inline-block', width: '20px', borderTop: '1px dashed #E24B4A' }} />
              Alert threshold
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Percentile bar ────────────────────────────────────────────────────
function PercentileBar({ percentile, opportunityDirection }: { percentile: number; opportunityDirection?: string }) {
  const isOpportunity = opportunityDirection === 'low-good' && percentile <= 15
  const isDanger = percentile >= 85
  const color = isOpportunity ? '#639922' : isDanger ? '#E24B4A' : percentile >= 65 ? '#BA7517' : '#8A8A84'
  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
          {isOpportunity ? '★ historically low' : isDanger ? '⚠ historically high' : `${percentile}th pct`}
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>30yr range</span>
      </div>
      <div style={{ height: '3px', background: 'var(--border-med)', borderRadius: '2px', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${percentile}%`, background: color, borderRadius: '2px', transition: 'width 0.4s ease' }} />
        <div style={{ position: 'absolute', top: '-2px', left: `${percentile}%`, transform: 'translateX(-50%)', width: '7px', height: '7px', borderRadius: '50%', background: color, border: '1.5px solid var(--card-bg)' }} />
      </div>
    </div>
  )
}


// Cracked-bell alert mark for the page's top-right. Muted (no glow) to sit
// quietly beside the title; the red badge shows the live active-alert count.
function AlertBell({ count, onClick }: { count: number; onClick?: () => void }) {
  const active = count > 0
  return (
    <button
      className="alert-bell"
      onClick={onClick}
      aria-label={active ? `${count} active alert${count > 1 ? 's' : ''}` : 'No active alerts'}
      title={active ? `${count} active alert${count > 1 ? 's' : ''}` : 'No active alerts'}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--term)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" />
        <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
        <path className="bell-crack" d="M12.6 6.4 L10.9 10 L13.1 12 L11.4 16" stroke="var(--text-secondary)" strokeWidth="1" />
      </svg>
      {active && <span className="alert-bell-badge">{count > 9 ? '9+' : count}</span>}
    </button>
  )
}

// Dev-only glow tuner (visible only with ?glow in the URL). Drag to taste,
// read the three values back, then bake them into :root and remove this.
function GlowTuner() {
  const [core, setCore] = useState(0.5)
  const [r, setR] = useState(42)
  const [warm, setWarm] = useState(50)
  const g = Math.round(224 - warm * 0.5), b = Math.round(176 - warm * 0.9)
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--glow-core', String(core))
    root.style.setProperty('--glow-r', r + 'px')
    root.style.setProperty('--glow-c', `255,${g},${b}`)
  }, [core, r, g, b])
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 200, width: 240, background: '#24262B', border: '0.5px solid rgba(255,255,255,0.16)', borderRadius: 10, padding: '13px 15px', fontFamily: 'var(--mono)', color: '#ECECEA', boxShadow: '0 10px 34px rgba(0,0,0,0.45)' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#9A9C9E', marginBottom: 10 }}>Glow tuner</div>
      <label style={{ display: 'block', fontSize: 11, marginBottom: 12 }}>
        brightness <b style={{ color: '#8AB84A' }}>{core.toFixed(2)}</b>
        <input type="range" min={0} max={1} step={0.02} value={core} onChange={e => setCore(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <label style={{ display: 'block', fontSize: 11, marginBottom: 12 }}>
        size <b style={{ color: '#8AB84A' }}>{r}px</b>
        <input type="range" min={10} max={150} step={1} value={r} onChange={e => setR(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <label style={{ display: 'block', fontSize: 11, marginBottom: 10 }}>
        warmth <b style={{ color: '#8AB84A' }}>255,{g},{b}</b>
        <input type="range" min={0} max={100} step={1} value={warm} onChange={e => setWarm(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </label>
      <div style={{ fontSize: 9.5, color: '#66686C', lineHeight: 1.4 }}>hover a card · read brightness / size / warmth back to me</div>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [events, setEvents] = useState<Array<{ name: string; date: string; daysUntil: number; released?: boolean; description: string; metricKey?: string }>>([])
  // Prefetched Bonds/Housing/Credit payloads so switching to those tabs is instant.
  const [bondsData, setBondsData] = useState<any>(null)
  const [housingData, setHousingData] = useState<any>(null)
  const [creditData, setCreditData] = useState<any>(null)
  const [inflationData, setInflationData] = useState<any>(null)
  const [laborData, setLaborData] = useState<any>(null)
  const [marketsData, setMarketsData] = useState<any>(null)
  const [globalData, setGlobalData] = useState<any>(null)
  const [sparklines, setSparklines] = useState<Record<string, DataPoint[]>>({})
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [activeChart, setActiveChart] = useState<{ key: string; label: string } | null>(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [notifOpen, setNotifOpen] = useState(false)
  const [tuner, setTuner] = useState(false)
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([])
  const [alertsSeenAt, setAlertsSeenAt] = useState(0)

  // Deep-link: open the tab named in ?tab= (used by the alert email's links).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const t = sp.get('tab')
    if (t && TABS.some(x => x.id === t)) setActiveTab(t)
    if (sp.has('glow')) setTuner(true)
  }, [])

  // Restore notification history + last-seen marker on mount.
  useEffect(() => {
    try {
      const h = localStorage.getItem(ALERT_HISTORY_KEY)
      if (h) setAlertHistory(JSON.parse(h))
      const s = localStorage.getItem(ALERTS_SEEN_KEY)
      if (s) setAlertsSeenAt(Number(s) || 0)
    } catch {}
  }, [])

  // Edge pierce: crossing a grey card's border briefly lights the edge you cross.
  // One delegated pointermove tracks which card the cursor is inside; only a change
  // (enter or leave) fires a one-shot flash — never on plain hover.
  useEffect(() => {
    // Grey graphite surfaces only — exclude tinted backgrounds (the active
    // alert strip, the risk/stabilizer callouts, the experiencing/doing boxes).
    const SEL = '.card,.panel,.ts-card,.bm-hero,.cal-col,.dc,.np-card,'
      + '.inf-hero,.inf-driver,.bn-hero,.bn-driver,.cr-hero,.cr-driver,'
      + '.hs-hero,.hs-driver,.gl-hero,.gl-driver,.lb-hero,.lb-driver,'
      + '.mk-hero,.mk-driver,.fp-banner,.wl'
    let lastCard: HTMLElement | null = null
    const flash = (el: HTMLElement, e: PointerEvent) => {
      el.classList.add('lantern')
      const r = el.getBoundingClientRect()
      const dx = e.clientX - r.left, dy = e.clientY - r.top
      const dTop = dy, dBottom = r.height - dy, dLeft = dx, dRight = r.width - dx
      const min = Math.min(dTop, dBottom, dLeft, dRight)
      el.dataset.edge = min === dTop ? 'top' : min === dBottom ? 'bottom' : min === dLeft ? 'left' : 'right'
      el.style.setProperty('--gx', `${Math.max(0, Math.min(r.width, dx))}px`)
      el.style.setProperty('--gy', `${Math.max(0, Math.min(r.height, dy))}px`)
      // restart the one-shot flash animation
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash')
    }
    const onMove = (e: PointerEvent) => {
      const card = ((e.target as Element | null)?.closest?.(SEL) as HTMLElement | null) || null
      if (card === lastCard) return       // still inside the same card (or still outside) → no pierce
      if (lastCard) flash(lastCard, e)    // crossed out of a card
      if (card) flash(card, e)            // crossed into a card
      lastCard = card
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })

    fetch('/api/calendar')
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .catch(() => {})
  }, [])

  // Warm the Bonds & Housing sections in the background after first paint, so
  // opening those tabs is instant instead of triggering a fresh fetch on click.
  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/bonds').then(r => r.json()).then(d => { if (d && !d.error) setBondsData(d) }).catch(() => {})
      fetch('/api/housing').then(r => r.json()).then(d => { if (d && !d.error) setHousingData(d) }).catch(() => {})
      fetch('/api/credit').then(r => r.json()).then(d => { if (d && !d.error) setCreditData(d) }).catch(() => {})
      fetch('/api/inflation').then(r => r.json()).then(d => { if (d && !d.error) setInflationData(d) }).catch(() => {})
      fetch('/api/labor').then(r => r.json()).then(d => { if (d && !d.error) setLaborData(d) }).catch(() => {})
      fetch('/api/markets').then(r => r.json()).then(d => { if (d && !d.error) setMarketsData(d) }).catch(() => {})
      fetch('/api/global').then(r => r.json()).then(d => { if (d && !d.error) setGlobalData(d) }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [])

  // After a "go to card" link, scroll the highlighted card into view on All Data,
  // then clear the flash so it's a one-shot.
  useEffect(() => {
    if (!highlightKey || activeTab !== 'all') return
    const el = document.querySelector(`[data-hlkey="${highlightKey}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => setHighlightKey(null), 2200)
    return () => clearTimeout(t)
  }, [highlightKey, activeTab])

  // Load sparklines for all indicators after data loads
  useEffect(() => {
    if (!data) return
    const keys = INDICATORS.map(i => i.key)
    keys.forEach(key => {
      fetch(`/api/history?key=${key}`)
        .then(r => r.json())
        .then(d => {
          if (d.series?.length > 1) {
            // Downsample to ~60 points for sparkline
            const s: DataPoint[] = d.series
            const step = Math.max(1, Math.floor(s.length / 60))
            setSparklines(prev => ({ ...prev, [key]: s.filter((_: DataPoint, i: number) => i % step === 0) }))
          }
        })
        .catch(() => {})
    })
  }, [data])

  const handleCardClick = useCallback((key: string, label: string) => {
    setActiveChart({ key, label })
  }, [])

  // Jump from an Overview link to the indicator's card: go to All Data (where the
  // cards live) and highlight it — don't auto-open the historical chart. The user
  // can open the chart from the card itself.
  const handleViewCard = useCallback((key: string) => {
    setActiveTab('all')
    setHighlightKey(key)
  }, [])

  // Live alerts = what's firing across the prefetched intelligence-tab models.
  // This is the client-side mirror of lib/alertEngine, so the bell badge and the
  // notification panel always agree with the cron-driven email + feed.
  const liveAlerts: PanelAlert[] = ([
    [inflationData, 'inflation', 'Inflation'],
    [laborData, 'labor', 'Labor'],
    [marketsData, 'markets', 'Markets'],
    [globalData, 'global', 'Global'],
    [bondsData, 'bonds', 'Bonds'],
    [creditData, 'credit', 'Credit'],
    [housingData, 'housing', 'Housing'],
  ] as [any, string, string][]).flatMap(([d, tab, tabLabel]) =>
    ((d?.alerts ?? []) as Array<{ id: string; title: string; what: string; why: string; affected: string[]; context: string }>).map(a => ({
      key: `${tab}:${a.id}`, id: a.id, tab, tabLabel,
      severity: severityOf(a.id, a.title), title: a.title, what: a.what,
      why: a.why, affected: a.affected, context: a.context,
    }))
  ).sort((x, y) => y.severity - x.severity)

  // Which tabs have actually loaded — only those can authoritatively "clear" a
  // stored alert (an unloaded tab tells us nothing, so we keep its last state).
  const loadedTabs = new Set<string>()
  ;([['inflation', inflationData], ['labor', laborData], ['markets', marketsData],
     ['global', globalData], ['bonds', bondsData], ['credit', creditData], ['housing', housingData]] as [string, any][])
    .forEach(([t, d]) => { if (d && !d.error) loadedTabs.add(t) })

  // Reconcile live alerts into the persistent history. Keyed on stable
  // signatures so this only runs when the firing set or loaded tabs change.
  const liveSig = liveAlerts.map(a => `${a.key}|${a.severity}|${a.title}`).join('~')
  const loadedSig = [...loadedTabs].sort().join(',')
  useEffect(() => {
    if (loadedTabs.size === 0) return
    const now = Date.now()
    const valOf = (a: { id: string; what?: string }) => barFor({ id: a.id, what: a.what ?? '' } as never)?.value ?? null
    setAlertHistory(prev => {
      const liveByKey = new Map(liveAlerts.map(a => [a.key, a]))
      const seen = new Set<string>()
      const merged: AlertHistoryItem[] = prev.map(h => {
        seen.add(h.key)
        const l = liveByKey.get(h.key)
        if (l) {                                                          // still firing — refresh + track value
          const v = valOf(l)
          const track = (h.track ?? []).slice()
          if (v != null && track[track.length - 1] !== v) track.push(v)
          return {
            ...h, ...l, lastSeen: now, cleared: false,
            value: v ?? h.value ?? null,
            peak: v != null ? Math.max(h.peak ?? v, v) : (h.peak ?? null),
            track: track.slice(-24),
            triggerValue: h.triggerValue ?? v ?? null,
          }
        }
        if (loadedTabs.has(h.tab)) return { ...h, cleared: true }        // tab loaded, no longer firing
        return h                                                         // tab not loaded — leave as-is
      })
      for (const a of liveAlerts) {
        if (!seen.has(a.key)) {
          const v = valOf(a)
          merged.push({ ...a, firstSeen: now, lastSeen: now, cleared: false, value: v, triggerValue: v, peak: v, track: v != null ? [v] : [] })
        }
      }
      merged.sort((x, y) =>
        (Number(x.cleared) - Number(y.cleared)) || (y.severity - x.severity) || (y.lastSeen - x.lastSeen))
      const next = merged.slice(0, 50)
      try { localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSig, loadedSig])

  const activeAlerts = alertHistory.filter(h => !h.cleared)
  const pastAlerts = alertHistory.filter(h => h.cleared)
  // Badge = unread: active alerts that first appeared since the panel was last opened.
  const unreadCount = activeAlerts.filter(a => a.firstSeen > alertsSeenAt).length

  // Per-section status colors for the monitor's status row — straight from each
  // prefetched model's overall tone (so it agrees with the email's status row).
  const sections = ([
    [inflationData, 'inflation', 'Inflation'], [laborData, 'labor', 'Labor'],
    [marketsData, 'markets', 'Markets'], [globalData, 'global', 'Global'],
    [bondsData, 'bonds', 'Bonds'], [creditData, 'credit', 'Credit'],
    [housingData, 'housing', 'Housing'],
  ] as [any, string, string][]).map(([d, tab, tabLabel]) => ({ tab, tabLabel, tone: (d?.status?.tone as string) ?? 'unknown' }))

  const markAlertsSeen = () => {
    const t = Date.now()
    setAlertsSeenAt(t)
    try { localStorage.setItem(ALERTS_SEEN_KEY, String(t)) } catch {}
  }
  // The bell toggles the monitor; opening marks everything active as seen.
  const toggleNotifications = () => {
    setNotifOpen(o => { if (!o) markAlertsSeen(); return !o })
  }
  // Overview's "N active — view" opens (never closes) the monitor.
  const openAlerts = () => { markAlertsSeen(); setNotifOpen(true) }

  return (
    <>
      <Head>
        <title>Is the World Breaking?</title>
        <meta name="description" content="A quiet macro dashboard. Alerts only when it matters." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #1B1C1F; --card-bg: #24262B;
          --text-primary: #ECECEA; --text-secondary: #9A9C9E; --text-muted: #66686C;
          --border: rgba(255,255,255,0.09); --border-med: rgba(255,255,255,0.17);
          --warn-bg: #272013; --alert-bg: #2A1E1D; --good-bg: #1C2616; --term: #6fae7d;
          --mono: 'DM Mono', monospace; --sans: 'DM Sans', system-ui, sans-serif;
          /* Single tone scale — one source for every status color on the site. */
          --good: #8AB84A; --neutral: #C7C24E; --warn: #D88B2F; --bad: #EF6B5E; --crisis: #E24B4A;
          --glow-c: 255,193,122; --glow-core: 0.5; --glow-r: 42px;
        }
        html, body { background: var(--bg); color: var(--text-primary); font-family: var(--sans); -webkit-font-smoothing: antialiased; }

        /* Edge pierce — crossing a grey card's border briefly lights THAT edge
           golden (a 1.5px line, brightest where you crossed, fading along it), then
           it fades to nothing. Fires only on the crossing, never on plain hover. */
        .lantern { position: relative; }
        .lantern::after { content: ''; position: absolute; pointer-events: none; opacity: 0; }
        .lantern[data-edge="top"]::after,
        .lantern[data-edge="bottom"]::after { left: 0; right: 0; height: 1.5px;
          background: radial-gradient(circle at var(--gx, 50%) 50%, rgba(var(--glow-c), var(--glow-core)), transparent var(--glow-r)); }
        .lantern[data-edge="left"]::after,
        .lantern[data-edge="right"]::after { top: 0; bottom: 0; width: 1.5px;
          background: radial-gradient(circle at 50% var(--gy, 50%), rgba(var(--glow-c), var(--glow-core)), transparent var(--glow-r)); }
        .lantern[data-edge="top"]::after { top: -0.5px; }
        .lantern[data-edge="bottom"]::after { bottom: -0.5px; }
        .lantern[data-edge="left"]::after { left: -0.5px; }
        .lantern[data-edge="right"]::after { right: -0.5px; }
        .lantern.flash::after { animation: edgeflash 0.6s ease-out; }
        @keyframes edgeflash { 0% { opacity: 0; } 16% { opacity: 1; } 100% { opacity: 0; } }
        .page { width: 100%; max-width: none; margin: 0; padding: 2rem clamp(1.25rem, 4vw, 4rem) 4rem; }
        /* Keep long prose readable even though the page is now wide */
        .summary-text, .hs-summary, .hs-subtitle, .hs-callout-text { max-width: 78ch; }

        .topbar { margin-bottom: 0.5rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
        /* Cracked-bell alert mark, top-right — muted to match the title (no glow) */
        .topbar-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .alert-bell { position: relative; flex-shrink: 0; background: none; border: none; padding: 4px; cursor: pointer; color: var(--term); opacity: 0.85; line-height: 0; transition: opacity 0.15s; }
        .alert-bell:hover { opacity: 1; }
        /* soft green glow — helps the crack read against the stroke */
        .alert-bell svg { filter: drop-shadow(0 0 3px rgba(111,174,125,0.55)); }
        .alert-bell .bell-crack { opacity: 0.7; }
        .alert-bell-badge { position: absolute; top: -1px; right: -2px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; background: #E24B4A; color: #fff; font-size: 9px; font-weight: 700; line-height: 15px; text-align: center; font-family: var(--mono); }
        .site-name { position: relative; display: inline-block; font-family: 'Space Mono', var(--mono); font-size: 14px; font-weight: 400; letter-spacing: 0.04em; color: var(--term); opacity: 0.78; }
        /* a bit of grain over the title — keeps it textured and in the background */
        .site-name::after { content: ''; position: absolute; inset: -1px -2px; pointer-events: none; mix-blend-mode: soft-light; opacity: 0.16;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 110px 110px; }
        .term-cursor { display: inline-block; width: 0.5em; height: 0.95em; margin-left: 3px; vertical-align: -0.1em; background: var(--term); opacity: 0.85; animation: termblink 1.2s steps(1, end) infinite; }
        @keyframes termblink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
        .site-tagline { font-size: 12px; color: var(--text-muted); margin-top: 2px; margin-bottom: 1rem; }
        .topbar-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

        .pill { font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 20px; font-family: var(--mono); display: inline-flex; align-items: center; gap: 5px; }
        .pill-ok { background: var(--good-bg); color: var(--good); }
        .pill-warn { background: var(--warn-bg); color: var(--warn); }
        .pill-alert { background: var(--alert-bg); color: var(--bad); }
        .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
        .dot-pulse { animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .meta { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }

        .summary-box {
          padding: 14px 16px; border-radius: 8px; margin: 1.25rem 0 1.75rem;
          border: 0.5px solid var(--border); background: var(--card-bg);
        }
        .summary-box.warn { border-color: var(--warn); background: var(--warn-bg); }
        .summary-box.alert { border-color: var(--bad); background: var(--alert-bg); }
        .summary-label { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 6px; color: var(--text-muted); font-family: var(--mono); display: flex; align-items: center; gap: 6px; }
        .summary-text { font-size: 13px; line-height: 1.65; color: var(--text-secondary); }
        .summary-time { font-size: 10px; color: var(--text-muted); font-family: var(--mono); margin-top: 8px; }

        .section { margin-bottom: 1.5rem; }
        .section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 6px; }

        .card {
          background: var(--card-bg); border: 0.5px solid var(--border);
          border-radius: 8px; padding: 12px 14px; cursor: pointer;
          transition: border-color 0.15s, transform 0.1s;
        }
        .card:hover { border-color: var(--border-med); transform: translateY(-1px); }
        .card:active { transform: translateY(0); }
        .card.is-hl { animation: cardflash 2.2s ease-out; }
        @keyframes cardflash {
          0%, 100% { box-shadow: 0 0 0 0 rgba(111,174,125,0); border-color: var(--border); }
          15%, 55% { box-shadow: 0 0 0 2px var(--term); border-color: var(--term); }
        }
        .card-label { font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        .card-label-left { display: flex; align-items: center; gap: 5px; }
        .card-expand { font-size: 10px; color: var(--text-muted); opacity: 0; transition: opacity 0.15s; }
        .card:hover .card-expand { opacity: 1; }
        .card-value { font-family: var(--mono); font-size: 20px; font-weight: 500; line-height: 1; }
        .card-change { font-size: 11px; margin-top: 3px; font-family: var(--mono); }
        .card-change.pos { color: var(--good); }
        .card-change.neg { color: var(--bad); }
        .card-context { font-size: 11px; margin-top: 7px; padding-top: 7px; border-top: 0.5px solid var(--border); line-height: 1.45; }
        .card-threshold { font-size: 10px; margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); font-family: var(--mono); color: var(--text-muted); }
        .opportunity-banner { font-size: 11px; padding: 6px 9px; border-radius: 5px; margin-top: 6px; background: var(--good-bg); color: var(--good); border: 0.5px solid rgba(138,184,74,0.3); font-family: var(--mono); line-height: 1.5; }

        .stress-box { border: 0.5px solid var(--border); background: var(--card-bg); border-radius: 10px; padding: 1.25rem; margin-bottom: 1.75rem; }
        .stress-grid { display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap; }
        .stress-gauge-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .stress-verdict { font-size: 13px; font-weight: 500; text-align: center; }
        .stress-change { font-size: 11px; font-family: var(--mono); }
        .stress-trend-col { flex: 1; min-width: 180px; }
        .stress-trend-label { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; }
        .stress-trend-empty { font-size: 11px; color: var(--text-muted); font-family: var(--mono); padding: 1rem 0; }
        .stress-cats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 16px; margin-top: 1.25rem; padding-top: 1.25rem; border-top: 0.5px solid var(--border); }
        .stress-cat-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
        .stress-cat-label { font-size: 11px; color: var(--text-secondary); }
        .stress-cat-pts { font-size: 11px; font-family: var(--mono); font-weight: 500; }
        .stress-cat-bar { height: 4px; background: var(--border-med); border-radius: 2px; overflow: hidden; }
        .stress-cat-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; }

        .calendar-strip { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 1.75rem; }
        .cal { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem 1.5rem; margin-bottom: 1.75rem; }
        @media (max-width: 640px) { .cal { grid-template-columns: 1fr; } }
        .cal-col { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1rem 1.1rem; }
        .cal-head { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); }
        .cal-row { padding: 8px 0; border-bottom: 0.5px solid var(--border); }
        .cal-row:last-child { border-bottom: none; padding-bottom: 0; }
        .cal-row.is-click { cursor: pointer; margin: 0 -6px; padding: 8px 6px; border-radius: 6px; transition: background 0.12s; }
        .cal-row.is-click:hover { background: var(--border); }
        .cal-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
        .cal-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
        .cal-when { font-size: 11px; color: var(--text-muted); font-family: var(--mono); white-space: nowrap; }
        .cal-when.soon { color: var(--warn); }
        .cal-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .cal-outcome { font-size: 11.5px; color: var(--text-secondary); margin-top: 3px; line-height: 1.45; }
        .cal-go { color: var(--text-muted); font-size: 10px; }
        .tabbar { display: flex; gap: 2px; overflow-x: auto; margin-bottom: 1.5rem; border-bottom: 0.5px solid var(--border); padding-bottom: 0; -webkit-overflow-scrolling: touch; }
        .tab { font-family: var(--sans); font-size: 13px; color: var(--text-muted); background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 12px; cursor: pointer; white-space: nowrap; transition: color 0.15s, border-color 0.15s; }
        .tab:hover { color: var(--text-secondary); }
        .tab.active { color: var(--text-primary); border-bottom-color: var(--text-primary); font-weight: 500; }
        .event-pill {
          font-size: 11px; font-family: var(--mono); padding: 4px 10px;
          border-radius: 20px; border: 0.5px solid var(--border);
          background: var(--card-bg); color: var(--text-secondary);
          display: flex; align-items: center; gap: 5px;
        }
        .event-pill.soon { border-color: var(--warn); background: var(--warn-bg); color: var(--warn); }
        .event-pill.today { border-color: var(--bad); background: var(--alert-bg); color: var(--bad); }
        @keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .sk-val { height: 20px; width: 60%; margin-bottom: 6px; }
        .sk-sub { height: 11px; width: 40%; }

        .footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 0.5px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
        .footer-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; }
        .footer-note { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }
        .disclaimer { font-size: 10px; color: var(--text-muted); line-height: 1.5; padding-top: 4px; }

        @media (max-width: 480px) { .grid { grid-template-columns: 1fr 1fr; } .card-value { font-size: 17px; } }
      `}</style>

      {activeChart && (
        <HistoryModal indicatorKey={activeChart.key} label={activeChart.label} onClose={() => setActiveChart(null)} />
      )}

      <div className="page">
        {tuner && <GlowTuner />}
        <div className="topbar">
          <div className="topbar-left">
            <div className="site-name">is the world breaking?...<span className="term-cursor" aria-hidden="true" /></div>
            <div className="site-tagline">quiet the noise · get alerts only when it matters</div>
          </div>
          <div className="topbar-actions">
            <AlertBell count={unreadCount} onClick={toggleNotifications} />
          </div>
        </div>

        <NotificationPanel
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          active={activeAlerts}
          past={pastAlerts}
          sections={sections}
          onNavigate={setActiveTab}
        />

        {/* Tab navigation */}
        <div className="tabbar">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <>
            <Overview data={data} events={events} onViewCard={handleViewCard} onNavigate={setActiveTab} onOpenAlerts={openAlerts} activeCount={activeAlerts.length} />

            {/* Economic calendar — recent releases & upcoming */}
            {events.length > 0 && (() => {
              const isReleased = (e: { released?: boolean; daysUntil: number }) => e.released ?? e.daysUntil < 0
              const past = events.filter(isReleased).sort((a, b) => b.daysUntil - a.daysUntil)
              const upcoming = events.filter(e => !isReleased(e))
              return (
                <div className="cal">
                  <div className="cal-col">
                    <div className="cal-head">Recent releases</div>
                    {past.length === 0 && <div className="cal-empty">Nothing in the last few weeks.</div>}
                    {past.map((e, i) => {
                      const ind = e.metricKey ? INDICATORS.find(x => x.key === e.metricKey) : undefined
                      const val = ind && data ? getValueForKey(data, ind.key) : null
                      let outcome: string | null = null
                      let onClick: (() => void) | undefined
                      if (ind && val != null) { outcome = outcomeLine(ind, val); onClick = () => setActiveChart({ key: ind.key, label: ind.label }) }
                      else if (e.name === 'Jobs Report' && data?.payrolls != null) { outcome = jobsOutcome(data.payrolls, data.payrollsAvg) }
                      const ago = e.daysUntil === 0 ? 'today' : e.daysUntil === -1 ? 'yesterday' : `${-e.daysUntil}d ago`
                      return (
                        <div
                          key={i}
                          className={`cal-row ${onClick ? 'is-click' : ''}`}
                          onClick={onClick}
                          role={onClick ? 'button' : undefined}
                          tabIndex={onClick ? 0 : undefined}
                        >
                          <div className="cal-row-top">
                            <span className="cal-name">{e.name}</span>
                            <span className="cal-when">{ago}</span>
                          </div>
                          {outcome
                            ? <div className="cal-outcome">{outcome}{onClick && <> <span className="cal-go">↗</span></>}</div>
                            : <div className="cal-desc">{e.description}</div>}
                        </div>
                      )
                    })}
                  </div>
                  <div className="cal-col">
                    <div className="cal-head">Upcoming</div>
                    {upcoming.length === 0 && <div className="cal-empty">No major releases in the next 30 days.</div>}
                    {upcoming.map((e, i) => {
                      const when = e.daysUntil === 0 ? 'today' : e.daysUntil === 1 ? 'tomorrow' : `in ${e.daysUntil}d`
                      return (
                        <div key={i} className="cal-row">
                          <div className="cal-row-top">
                            <span className="cal-name">{e.name}</span>
                            <span className={`cal-when ${e.daysUntil <= 3 ? 'soon' : ''}`}>{when}</span>
                          </div>
                          <div className="cal-desc">{e.description}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {/* ── BONDS TAB — bond-market intelligence model, not cards ── */}
        {activeTab === 'bonds' && <Bonds initialData={bondsData} />}

        {/* ── HOUSING TAB — status model, not a dashboard ── */}
        {activeTab === 'housing' && <Housing initialData={housingData} />}

        {/* ── CREDIT TAB — credit-market intelligence model, not cards ── */}
        {activeTab === 'credit' && <Credit initialData={creditData} />}

        {/* ── INFLATION TAB — inflation intelligence model, not cards ── */}
        {activeTab === 'inflation' && <Inflation initialData={inflationData} />}

        {/* ── LABOR TAB — labor-market intelligence model, not cards ── */}
        {activeTab === 'labor' && <Labor initialData={laborData} />}

        {/* ── MARKETS TAB — markets intelligence model, not cards ── */}
        {activeTab === 'markets' && <Markets initialData={marketsData} />}

        {/* ── GLOBAL TAB — global-risk intelligence model, not cards ── */}
        {activeTab === 'global' && <Global initialData={globalData} />}

        {/* ── CATEGORY TABS — filtered card sections ── */}
        {(TABS.find(t => t.id === activeTab)?.sections || []).map(section => (
          <div className="section" key={section.label}>
            <div className="section-label">{section.label}</div>
            <div className="grid">
              {section.keys.map(key => {
                const indicator = INDICATORS.find(i => i.key === key)!
                const value = data ? getValueForKey(data, key) : null
                const change = data ? getChangeForKey(data, key) : null
                const status: AlertStatus = value != null ? getStatus(indicator, value) : 'ok'
                const styles = STATUS_STYLES[status]
                const percentile = value != null ? getPercentile(indicator, value) : null
                const contextText = value != null ? getContextText(key, value, status) : null
                const opportunityText = value != null && percentile != null ? getOpportunityText(key, percentile, value) : null
                const cardStyle: React.CSSProperties = status !== 'ok' ? { borderColor: styles.border, background: styles.bg } : {}
                const thresholdText = indicator.alertAbove != null ? `alert ↑ ${indicator.alertAbove}${indicator.unit}` : indicator.alertBelow != null ? `alert ↓ ${indicator.alertBelow}${indicator.unit}` : null
                const sparkSeries = sparklines[key]

                return (
                  <div className={`card ${highlightKey === key ? 'is-hl' : ''}`} key={key} data-hlkey={key} style={cardStyle} onClick={() => handleCardClick(key, indicator.label)}>
                    <div className="card-label">
                      <span className="card-label-left">
                        <span className={`dot ${status !== 'ok' ? 'dot-pulse' : ''}`} style={{ background: styles.dot }} />
                        {indicator.label}
                      </span>
                      <span className="card-expand">↗</span>
                    </div>

                    {loading ? (
                      <><div className="skeleton sk-val" /><div className="skeleton sk-sub" /></>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px' }}>
                          <div>
                            <div className="card-value" style={{ color: styles.value }}>{formatValue(key, value)}</div>
                            {change != null && (
                              <div className={`card-change ${change >= 0 ? 'pos' : 'neg'}`}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</div>
                            )}
                            {key === 'yieldCurve' && value != null && (
                              <div className="card-change" style={{ color: 'var(--text-muted)' }}>{value < 0 ? 'inverted' : 'normal'}</div>
                            )}
                          </div>
                          {sparkSeries && <Sparkline series={sparkSeries} status={status} />}
                        </div>

                        {percentile != null && <PercentileBar percentile={percentile} opportunityDirection={indicator.opportunityDirection} />}
                        {contextText && <div className="card-context" style={{ color: styles.note }}>{contextText}</div>}
                        {opportunityText && !contextText && <div className="opportunity-banner">{opportunityText}</div>}
                        {!contextText && !opportunityText && thresholdText && <div className="card-threshold">{thresholdText}</div>}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div className="footer">
          <div className="footer-row">
            <span className="footer-note">Economic data from the Federal Reserve · stock prices refresh every 15 min</span>
            <span className="footer-note">Alerts: email · in-app</span>
          </div>
          <p className="disclaimer">
            For informational purposes only. Not financial advice. Historical context is descriptive, not predictive.
            Consult a licensed financial advisor before making any investment decisions.
          </p>
        </div>
      </div>
    </>
  )
}
