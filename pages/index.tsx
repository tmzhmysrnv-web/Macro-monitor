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

function getValueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper,
    mortgage30: data.mortgage30,
  }
  return map[key] ?? null
}

function getChangeForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    sp500: data.sp500Change, dxy: data.dxyChange, gold: data.goldChange,
    oil: data.oilChange, copper: data.copperChange, vix: null,
  }
  return map[key] ?? null
}

function formatValue(key: string, value: number | null): string {
  if (value == null) return '—'
  if (key === 'sp500') return value.toLocaleString('en-US')
  if (key === 'gold') return `$${value.toLocaleString('en-US')}`
  if (key === 'oil') return `$${value.toFixed(2)}`
  if (key === 'copper') return `$${value.toFixed(3)}`
  if (key === 'dxy') return value.toFixed(2)
  if (key === 'joblessClaims') return `${value.toFixed(0)}k`
  if (key === 'yieldCurve') return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  if (['treasury10y', 'fedfunds', 'cpi', 'hySpread', 'igSpread', 'mortgage30'].includes(key)) return `${value.toFixed(2)}%`
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
  ok:    { dot: '#639922', value: 'inherit',  border: 'var(--border)',    bg: 'var(--card-bg)',  note: '#888' },
  warn:  { dot: '#BA7517', value: '#854F0B',  border: '#EF9F27',          bg: 'var(--warn-bg)', note: '#BA7517' },
  alert: { dot: '#E24B4A', value: '#A32D2D',  border: '#E24B4A',          bg: 'var(--alert-bg)',note: '#A32D2D' },
}

const SECTIONS = [
  { label: 'Volatility & Risk',    keys: ['vix', 'hySpread', 'igSpread'] },
  { label: 'Rates & Housing',      keys: ['treasury10y', 'fedfunds', 'yieldCurve', 'mortgage30'] },
  { label: 'Inflation & Labor',    keys: ['cpi', 'joblessClaims'] },
  { label: 'Dollar & Commodities', keys: ['dxy', 'gold', 'oil', 'copper'] },
  { label: 'Markets',              keys: ['sp500'] },
]

// Tab definitions — Overview is special; the rest filter the card sections
const TABS: { id: string; label: string; sections?: typeof SECTIONS }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'bonds',     label: 'Bonds' },   // renders the <Bonds /> intelligence model, not indicator cards
  { id: 'housing',   label: 'Housing' }, // renders the <Housing /> status model, not indicator cards
  { id: 'credit',    label: 'Credit' },  // renders the <Credit /> intelligence model, not indicator cards
  { id: 'inflation', label: 'Inflation', sections: [{ label: 'Inflation', keys: ['cpi', 'oil'] }] },
  { id: 'labor',     label: 'Labor',     sections: [{ label: 'Labor Market', keys: ['joblessClaims'] }] },
  { id: 'markets',   label: 'Markets',   sections: [{ label: 'Equities & Volatility', keys: ['sp500', 'vix'] }] },
  { id: 'global',    label: 'Global',    sections: [{ label: 'Dollar & Commodities', keys: ['dxy', 'gold', 'oil', 'copper'] }] },
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


export default function Dashboard() {
  const [data, setData] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [events, setEvents] = useState<Array<{ name: string; date: string; daysUntil: number; description: string; metricKey?: string }>>([])
  // Prefetched Bonds/Housing/Credit payloads so switching to those tabs is instant.
  const [bondsData, setBondsData] = useState<any>(null)
  const [housingData, setHousingData] = useState<any>(null)
  const [creditData, setCreditData] = useState<any>(null)
  const [sparklines, setSparklines] = useState<Record<string, DataPoint[]>>({})
  const [activeChart, setActiveChart] = useState<{ key: string; label: string } | null>(null)
  const [activeTab, setActiveTab] = useState('overview')

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
    }, 600)
    return () => clearTimeout(t)
  }, [])

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

  // Jump from an Overview alert to the indicator's metric card: switch to the
  // most specific tab that holds it, then open its chart.
  const handleViewCard = useCallback((key: string, label: string) => {
    const specific = TABS.find(t => t.id !== 'all' && t.sections?.some(s => s.keys.includes(key)))
    setActiveTab(specific?.id ?? 'all')
    setActiveChart({ key, label })
  }, [])

  const allStatuses = data ? INDICATORS.map(ind => {
    const val = getValueForKey(data, ind.key)
    return val != null ? getStatus(ind, val) : 'ok' as AlertStatus
  }) : []

  const alertCount = allStatuses.filter(s => s === 'alert').length
  const warnCount  = allStatuses.filter(s => s === 'warn').length
  const overallStatus: AlertStatus = alertCount > 0 ? 'alert' : warnCount > 0 ? 'warn' : 'ok'
  const overallLabel = alertCount > 0 ? `${alertCount} alert${alertCount > 1 ? 's' : ''}` : warnCount > 0 ? `${warnCount} warning${warnCount > 1 ? 's' : ''}` : 'No — all clear'
  const fetchedTime = data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : ''

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
          --bg: #F7F6F3; --card-bg: #FFFFFF;
          --text-primary: #1A1A18; --text-secondary: #6B6B67; --text-muted: #9E9E9A;
          --border: rgba(0,0,0,0.08); --border-med: rgba(0,0,0,0.15);
          --warn-bg: #FFFBF2; --alert-bg: #FFF5F5; --term: #6b9576;
          --mono: 'DM Mono', monospace; --sans: 'DM Sans', system-ui, sans-serif;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #111110; --card-bg: #1C1C1A;
            --text-primary: #EEEEE8; --text-secondary: #8A8A84; --text-muted: #5A5A56;
            --border: rgba(255,255,255,0.07); --border-med: rgba(255,255,255,0.14);
            --warn-bg: #1E1A10; --alert-bg: #1E1010; --term: #6fae7d;
          }
        }
        html, body { background: var(--bg); color: var(--text-primary); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
        .page { width: 100%; max-width: none; margin: 0; padding: 2rem clamp(1.25rem, 4vw, 4rem) 4rem; }
        /* Keep long prose readable even though the page is now wide */
        .summary-text, .hs-summary, .hs-subtitle, .hs-callout-text { max-width: 78ch; }

        .topbar { margin-bottom: 0.5rem; }
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
        .pill-ok { background: #EAF3DE; color: #3B6D11; }
        .pill-warn { background: #FAEEDA; color: #854F0B; }
        .pill-alert { background: #FCEBEB; color: #A32D2D; }
        .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
        .dot-pulse { animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .meta { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }

        .summary-box {
          padding: 14px 16px; border-radius: 8px; margin: 1.25rem 0 1.75rem;
          border: 0.5px solid var(--border); background: var(--card-bg);
        }
        .summary-box.warn { border-color: #EF9F27; background: var(--warn-bg); }
        .summary-box.alert { border-color: #E24B4A; background: var(--alert-bg); }
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
        .card-label { font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        .card-label-left { display: flex; align-items: center; gap: 5px; }
        .card-expand { font-size: 10px; color: var(--text-muted); opacity: 0; transition: opacity 0.15s; }
        .card:hover .card-expand { opacity: 1; }
        .card-value { font-family: var(--mono); font-size: 20px; font-weight: 500; line-height: 1; }
        .card-change { font-size: 11px; margin-top: 3px; font-family: var(--mono); }
        .card-change.pos { color: #3B6D11; }
        .card-change.neg { color: #A32D2D; }
        .card-context { font-size: 11px; margin-top: 7px; padding-top: 7px; border-top: 0.5px solid var(--border); line-height: 1.45; }
        .card-threshold { font-size: 10px; margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); font-family: var(--mono); color: var(--text-muted); }
        .opportunity-banner { font-size: 11px; padding: 6px 9px; border-radius: 5px; margin-top: 6px; background: #EAF3DE; color: #3B6D11; border: 0.5px solid #B8DCA0; font-family: var(--mono); line-height: 1.5; }

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
        .cal-when.soon { color: #854F0B; }
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
        .event-pill.soon { border-color: #EF9F27; background: var(--warn-bg); color: #854F0B; }
        .event-pill.today { border-color: #E24B4A; background: var(--alert-bg); color: #A32D2D; }
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
        <div className="topbar">
          <div className="site-name">is the world breaking?...<span className="term-cursor" aria-hidden="true" /></div>
          <div className="site-tagline">a quiet macro dashboard · alerts only when it matters</div>
          <div className="topbar-row">
            {!loading && !error && (
              <span className={`pill pill-${overallStatus}`}>
                <span className={`dot ${overallStatus !== 'ok' ? 'dot-pulse' : ''}`} style={{ background: STATUS_STYLES[overallStatus].dot }} />
                {overallLabel}
              </span>
            )}
            {fetchedTime && <span className="meta">{fetchedTime}</span>}
          </div>
        </div>

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
            <Overview data={data} events={events} onViewCard={handleViewCard} />

            {/* Economic calendar — recent releases & upcoming */}
            {events.length > 0 && (() => {
              const past = events.filter(e => e.daysUntil < 0).sort((a, b) => b.daysUntil - a.daysUntil)
              const upcoming = events.filter(e => e.daysUntil >= 0)
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
                  <div className="card" key={key} style={cardStyle} onClick={() => handleCardClick(key, indicator.label)}>
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
            <span className="footer-note">Data: FRED API · Yahoo Finance · refreshes every 15 min</span>
            <span className="footer-note">Alerts: email · SMS · in-app</span>
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
