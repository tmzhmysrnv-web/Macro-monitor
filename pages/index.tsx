// pages/index.tsx
import { useEffect, useState } from 'react'
import Head from 'next/head'
import type { MacroData } from '../lib/fetchData'
import {
  INDICATORS, getStatus, getPercentile, getContextText, getOpportunityText,
  type AlertStatus,
} from '../lib/thresholds'

function getValueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper,
  }
  return map[key] ?? null
}

function getChangeForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    sp500: data.sp500Change, dxy: data.dxyChange, gold: data.goldChange,
    oil: data.oilChange, copper: data.copperChange,
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
  if (['treasury10y', 'fedfunds', 'cpi', 'hySpread', 'igSpread'].includes(key)) return `${value.toFixed(2)}%`
  return value.toFixed(1)
}

const STATUS_STYLES: Record<AlertStatus, { dot: string; value: string; border: string; bg: string; note: string }> = {
  ok:    { dot: '#639922', value: 'inherit',  border: 'var(--border)',   bg: 'var(--card-bg)', note: '#999' },
  warn:  { dot: '#BA7517', value: '#854F0B',  border: '#EF9F27',         bg: 'var(--warn-bg)', note: '#BA7517' },
  alert: { dot: '#E24B4A', value: '#A32D2D',  border: '#E24B4A',         bg: 'var(--alert-bg)',note: '#A32D2D' },
}

const SECTIONS = [
  { label: 'Volatility & Risk',    keys: ['vix', 'hySpread', 'igSpread'] },
  { label: 'Rates & Yield Curve',  keys: ['treasury10y', 'fedfunds', 'yieldCurve'] },
  { label: 'Inflation & Labor',    keys: ['cpi', 'joblessClaims'] },
  { label: 'Dollar & Commodities', keys: ['dxy', 'gold', 'oil', 'copper'] },
  { label: 'Markets',              keys: ['sp500'] },
]

function getDashboardSummary(data: MacroData): { text: string; status: AlertStatus } {
  const checks = [
    { key: 'vix', v: data.vix },
    { key: 'treasury10y', v: data.treasury10y },
    { key: 'cpi', v: data.cpi },
    { key: 'hySpread', v: data.hySpread },
    { key: 'igSpread', v: data.igSpread },
    { key: 'joblessClaims', v: data.joblessClaims },
    { key: 'yieldCurve', v: data.yieldCurve },
    { key: 'oil', v: data.oil },
    { key: 'dxy', v: data.dxy },
  ]
  const statuses = checks.map(c => {
    const ind = INDICATORS.find(i => i.key === c.key)
    return c.v != null && ind ? getStatus(ind, c.v) : 'ok'
  })
  const alerts = statuses.filter(s => s === 'alert').length
  const warns = statuses.filter(s => s === 'warn').length

  // Build contextual summary
  const alertedKeys = checks.filter((c, i) => statuses[i] === 'alert').map(c => c.key)
  const warnedKeys  = checks.filter((c, i) => statuses[i] === 'warn').map(c => c.key)

  const labelMap: Record<string, string> = {
    vix: 'volatility', treasury10y: '10Y yields', cpi: 'inflation',
    hySpread: 'HY credit spreads', igSpread: 'IG credit spreads',
    joblessClaims: 'jobless claims', yieldCurve: 'yield curve',
    oil: 'oil prices', dxy: 'the dollar',
  }

  if (alerts === 0 && warns === 0) {
    // Check for opportunity conditions
    const ffPerc = data.fedfunds != null ? getPercentile(INDICATORS.find(i => i.key === 'fedfunds')!, data.fedfunds) : null
    const t10yPerc = data.treasury10y != null ? getPercentile(INDICATORS.find(i => i.key === 'treasury10y')!, data.treasury10y) : null
    if (ffPerc != null && ffPerc <= 15) {
      return { text: `All indicators in normal range. Notably, the Fed Funds rate is in the bottom ${ffPerc}th historical percentile — a historically rare low-rate environment that favors borrowers and long-duration assets.`, status: 'ok' }
    }
    if (t10yPerc != null && t10yPerc <= 15) {
      return { text: `All clear. 10Y yields are historically low — a window that historically favors locking in long-term fixed-rate debt like mortgages. No stress signals anywhere in the data.`, status: 'ok' }
    }
    return { text: 'All indicators within normal historical ranges. No stress signals. Markets are calm, credit is orderly, and labor conditions are healthy.', status: 'ok' }
  }

  if (alerts > 0) {
    const names = alertedKeys.map(k => labelMap[k] || k).join(' and ')
    const warnNames = warnedKeys.length > 0 ? ` ${warnedKeys.map(k => labelMap[k] || k).join(' and ')} are also elevated.` : ''
    if (alerts >= 3) {
      return { text: `Multiple indicators in alert territory — ${names}.${warnNames} When this many signals fire simultaneously, historical precedent suggests a significant macro stress event is underway. Review your portfolio defensively.`, status: 'alert' }
    }
    return { text: `${names.charAt(0).toUpperCase() + names.slice(1)} ${alerts > 1 ? 'are' : 'is'} in alert territory.${warnNames} Monitor closely — single-indicator alerts can resolve quickly, but watch for others joining.`, status: 'alert' }
  }

  // Warns only
  const names = warnedKeys.map(k => labelMap[k] || k).join(' and ')
  return { text: `${names.charAt(0).toUpperCase() + names.slice(1)} ${warns > 1 ? 'are' : 'is'} approaching alert levels. No threshold has been crossed yet, but conditions are worth watching. Check back daily.`, status: 'warn' }
}

function PercentileBar({ percentile, opportunityDirection }: { percentile: number; opportunityDirection?: string }) {
  const isOpportunity = opportunityDirection === 'low-good' && percentile <= 15
  const isDanger = percentile >= 85
  const barColor = isOpportunity ? '#639922' : isDanger ? '#E24B4A' : percentile >= 65 ? '#BA7517' : '#8A8A84'

  return (
    <div style={{ marginTop: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
          {isOpportunity ? '★ historically low' : isDanger ? '⚠ historically high' : `${percentile}th pct`}
        </span>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>30yr range</span>
      </div>
      <div style={{ height: '3px', background: 'var(--border-med)', borderRadius: '2px', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${percentile}%`, background: barColor, borderRadius: '2px', transition: 'width 0.4s ease' }} />
        <div style={{ position: 'absolute', top: '-2px', left: `${percentile}%`, transform: 'translateX(-50%)', width: '7px', height: '7px', borderRadius: '50%', background: barColor, border: '1.5px solid var(--card-bg)' }} />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [])

  const allStatuses = data ? INDICATORS.map(ind => {
    const val = getValueForKey(data, ind.key)
    return val != null ? getStatus(ind, val) : 'ok' as AlertStatus
  }) : []

  const alertCount = allStatuses.filter(s => s === 'alert').length
  const warnCount  = allStatuses.filter(s => s === 'warn').length
  const overallStatus: AlertStatus = alertCount > 0 ? 'alert' : warnCount > 0 ? 'warn' : 'ok'
  const overallLabel = alertCount > 0 ? `${alertCount} alert${alertCount > 1 ? 's' : ''}` : warnCount > 0 ? `${warnCount} warning${warnCount > 1 ? 's' : ''}` : 'All clear'
  const fetchedTime = data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : ''
  const summary = data ? getDashboardSummary(data) : null

  return (
    <>
      <Head>
        <title>Macro Monitor</title>
        <meta name="description" content="Quiet macro dashboard — alerts only when it matters" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #F7F6F3; --card-bg: #FFFFFF;
          --text-primary: #1A1A18; --text-secondary: #6B6B67; --text-muted: #9E9E9A;
          --border: rgba(0,0,0,0.08); --border-med: rgba(0,0,0,0.13);
          --warn-bg: #FFFBF2; --alert-bg: #FFF5F5;
          --mono: 'DM Mono', monospace; --sans: 'DM Sans', system-ui, sans-serif;
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #111110; --card-bg: #1C1C1A;
            --text-primary: #EEEEE8; --text-secondary: #8A8A84; --text-muted: #5A5A56;
            --border: rgba(255,255,255,0.07); --border-med: rgba(255,255,255,0.12);
            --warn-bg: #1E1A10; --alert-bg: #1E1010;
          }
        }
        html, body { background: var(--bg); color: var(--text-primary); font-family: var(--sans); -webkit-font-smoothing: antialiased; }
        .page { max-width: 700px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
        .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
        .wordmark { font-family: var(--mono); font-size: 13px; font-weight: 500; letter-spacing: 0.04em; }
        .wordmark span { color: var(--text-muted); }
        .pill { font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 20px; font-family: var(--mono); display: inline-flex; align-items: center; gap: 5px; }
        .pill-ok { background: #EAF3DE; color: #3B6D11; }
        .pill-warn { background: #FAEEDA; color: #854F0B; }
        .pill-alert { background: #FCEBEB; color: #A32D2D; }
        .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
        .dot-pulse { animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .meta { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }
        .summary {
          padding: 12px 14px; border-radius: 8px; margin-bottom: 1.75rem;
          border: 0.5px solid var(--border); background: var(--card-bg);
          font-size: 13px; line-height: 1.6; color: var(--text-secondary);
        }
        .summary.warn { border-color: #EF9F27; background: var(--warn-bg); color: #854F0B; }
        .summary.alert { border-color: #E24B4A; background: var(--alert-bg); color: #A32D2D; }
        .summary-label { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 5px; opacity: 0.7; font-family: var(--mono); }
        .opportunity-banner {
          font-size: 11px; padding: 7px 10px; border-radius: 6px; margin-top: 6px;
          background: #EAF3DE; color: #3B6D11; border: 0.5px solid #B8DCA0;
          font-family: var(--mono); line-height: 1.5;
        }
        .section { margin-bottom: 1.5rem; }
        .section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 6px; }
        .card { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 12px 14px; transition: border-color 0.2s; }
        .card:hover { border-color: var(--border-med); }
        .card-label { font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 5px; margin-bottom: 6px; }
        .card-value { font-family: var(--mono); font-size: 20px; font-weight: 500; line-height: 1; }
        .card-change { font-size: 11px; margin-top: 3px; font-family: var(--mono); }
        .card-change.pos { color: #3B6D11; }
        .card-change.neg { color: #A32D2D; }
        .card-context { font-size: 11px; margin-top: 7px; padding-top: 7px; border-top: 0.5px solid var(--border); line-height: 1.45; }
        .card-threshold { font-size: 10px; margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); font-family: var(--mono); color: var(--text-muted); }
        .skeleton { background: var(--border); border-radius: 4px; animation: shimmer 1.4s ease-in-out infinite; }
        @keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .sk-val { height: 20px; width: 60%; margin-bottom: 6px; }
        .sk-sub { height: 11px; width: 40%; }
        .footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 0.5px solid var(--border); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
        .footer-note { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }
        @media (max-width: 480px) { .grid { grid-template-columns: 1fr 1fr; } .card-value { font-size: 17px; } }
      `}</style>

      <div className="page">
        <div className="topbar">
          <div className="wordmark">macro<span>monitor</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {!loading && !error && (
              <span className={`pill pill-${overallStatus}`}>
                <span className={`dot ${overallStatus !== 'ok' ? 'dot-pulse' : ''}`} style={{ background: STATUS_STYLES[overallStatus].dot }} />
                {overallLabel}
              </span>
            )}
            {fetchedTime && <span className="meta">{fetchedTime}</span>}
          </div>
        </div>

        {summary && !loading && (
          <div className={`summary ${summary.status !== 'ok' ? summary.status : ''}`}>
            <div className="summary-label">Dashboard summary</div>
            {summary.text}
          </div>
        )}

        {SECTIONS.map(section => (
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
                const opportunityText = value != null && percentile != null
                  ? getOpportunityText(key, percentile, value) : null
                const cardStyle: React.CSSProperties = status !== 'ok'
                  ? { borderColor: styles.border, background: styles.bg } : {}
                const thresholdText = indicator.alertAbove != null
                  ? `alert ↑ ${indicator.alertAbove}${indicator.unit}`
                  : indicator.alertBelow != null ? `alert ↓ ${indicator.alertBelow}${indicator.unit}` : null

                return (
                  <div className="card" key={key} style={cardStyle}>
                    <div className="card-label">
                      <span className={`dot ${status !== 'ok' ? 'dot-pulse' : ''}`} style={{ background: styles.dot }} />
                      {indicator.label}
                    </div>
                    {loading ? (
                      <><div className="skeleton sk-val" /><div className="skeleton sk-sub" /></>
                    ) : (
                      <>
                        <div className="card-value" style={{ color: styles.value }}>{formatValue(key, value)}</div>
                        {change != null && (
                          <div className={`card-change ${change >= 0 ? 'pos' : 'neg'}`}>
                            {change >= 0 ? '+' : ''}{change.toFixed(2)}% today
                          </div>
                        )}
                        {key === 'yieldCurve' && value != null && (
                          <div className="card-change" style={{ color: 'var(--text-muted)' }}>
                            {value < 0 ? 'inverted' : 'normal'}
                          </div>
                        )}
                        {percentile != null && (
                          <PercentileBar percentile={percentile} opportunityDirection={indicator.opportunityDirection} />
                        )}
                        {contextText && (
                          <div className="card-context" style={{ color: styles.note }}>{contextText}</div>
                        )}
                        {opportunityText && !contextText && (
                          <div className="opportunity-banner">{opportunityText}</div>
                        )}
                        {!contextText && !opportunityText && thresholdText && (
                          <div className="card-threshold">{thresholdText}</div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <div className="footer">
          <span className="footer-note">Data: FRED API · Yahoo Finance · Updates every 15 min</span>
          <span className="footer-note">Alerts: email · SMS · in-app</span>
        </div>
      </div>
    </>
  )
}
