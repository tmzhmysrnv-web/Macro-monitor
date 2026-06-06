// pages/index.tsx
import { useEffect, useState } from 'react'
import Head from 'next/head'
import type { MacroData } from '../lib/fetchData'
import { INDICATORS, getStatus, type AlertStatus } from '../lib/thresholds'

function getValueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix,
    treasury10y: data.treasury10y,
    fedfunds: data.fedfunds,
    cpi: data.cpi,
    joblessClaims: data.joblessClaims,
    yieldCurve: data.yieldCurve,
    hySpread: data.hySpread,
    igSpread: data.igSpread,
    sp500: data.sp500,
  }
  return map[key] ?? null
}

function formatValue(key: string, value: number | null): string {
  if (value == null) return '—'
  if (key === 'sp500') return value.toLocaleString('en-US')
  if (key === 'joblessClaims') return `${value.toFixed(0)}k`
  if (key === 'yieldCurve') return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  if (['treasury10y', 'fedfunds', 'cpi', 'hySpread'].includes(key)) return `${value.toFixed(2)}%`
  return value.toFixed(1)
}

function getSubLabel(key: string, data: MacroData): string {
  if (key === 'yieldCurve') {
    const v = data.yieldCurve
    if (v == null) return ''
    return v < 0 ? 'inverted' : 'normal'
  }
  if (key === 'sp500' && data.sp500Change != null) {
    const c = data.sp500Change
    return `${c >= 0 ? '+' : ''}${c.toFixed(2)}% today`
  }
  return ''
}

type StatusConfig = {
  dot: string
  value: string
  border: string
  bg: string
  note: string
}

const STATUS_STYLES: Record<AlertStatus, StatusConfig> = {
  ok:    { dot: '#639922', value: 'inherit', border: 'var(--border)', bg: 'var(--card-bg)', note: '#999' },
  warn:  { dot: '#BA7517', value: '#854F0B', border: '#EF9F27',       bg: '#FFFBF2',       note: '#BA7517' },
  alert: { dot: '#E24B4A', value: '#A32D2D', border: '#E24B4A',       bg: '#FFF5F5',       note: '#A32D2D' },
}

const SECTIONS = [
  { label: 'Volatility & risk',     keys: ['vix', 'hySpread', 'igSpread'] },
  { label: 'Rates & yield curve',   keys: ['treasury10y', 'fedfunds', 'yieldCurve'] },
  { label: 'Inflation & labor',     keys: ['cpi', 'joblessClaims'] },
  { label: 'Markets',               keys: ['sp500'] },
]

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

  const allStatuses = data
    ? INDICATORS.map(ind => {
        const val = getValueForKey(data, ind.key)
        return val != null ? getStatus(ind, val) : 'ok'
      })
    : []

  const alertCount = allStatuses.filter(s => s === 'alert').length
  const warnCount  = allStatuses.filter(s => s === 'warn').length

  const overallStatus: AlertStatus =
    alertCount > 0 ? 'alert' : warnCount > 0 ? 'warn' : 'ok'

  const overallLabel =
    alertCount > 0 ? `${alertCount} alert${alertCount > 1 ? 's' : ''}` :
    warnCount  > 0 ? `${warnCount} warning${warnCount > 1 ? 's' : ''}` :
    'All clear'

  const fetchedTime = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York'
      }) + ' ET'
    : ''

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
          --bg: #F7F6F3;
          --card-bg: #FFFFFF;
          --text-primary: #1A1A18;
          --text-secondary: #6B6B67;
          --text-muted: #9E9E9A;
          --border: rgba(0,0,0,0.08);
          --border-med: rgba(0,0,0,0.13);
          --mono: 'DM Mono', monospace;
          --sans: 'DM Sans', system-ui, sans-serif;
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #111110;
            --card-bg: #1C1C1A;
            --text-primary: #EEEEE8;
            --text-secondary: #8A8A84;
            --text-muted: #5A5A56;
            --border: rgba(255,255,255,0.07);
            --border-med: rgba(255,255,255,0.12);
          }
        }

        html, body { background: var(--bg); color: var(--text-primary); font-family: var(--sans); -webkit-font-smoothing: antialiased; }

        .page { max-width: 680px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }

        .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; }
        .wordmark { font-family: var(--mono); font-size: 13px; font-weight: 500; letter-spacing: 0.04em; color: var(--text-primary); }
        .wordmark span { color: var(--text-muted); }

        .pill {
          font-size: 11px; font-weight: 500; padding: 3px 10px;
          border-radius: 20px; font-family: var(--mono);
          display: inline-flex; align-items: center; gap: 5px;
        }
        .pill-ok    { background: #EAF3DE; color: #3B6D11; }
        .pill-warn  { background: #FAEEDA; color: #854F0B; }
        .pill-alert { background: #FCEBEB; color: #A32D2D; }

        .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
        .dot-pulse { animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

        .meta { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }

        .section { margin-bottom: 1.5rem; }
        .section-label {
          font-size: 10px; font-weight: 500; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--text-muted);
          margin-bottom: 8px; padding-bottom: 6px;
          border-bottom: 0.5px solid var(--border);
        }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 6px; }

        .card {
          background: var(--card-bg);
          border: 0.5px solid var(--border);
          border-radius: 8px;
          padding: 12px 14px;
          transition: border-color 0.2s;
        }
        .card:hover { border-color: var(--border-med); }

        .card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        .card-label { font-size: 11px; color: var(--text-secondary); display: flex; align-items: center; gap: 5px; }
        .card-value { font-family: var(--mono); font-size: 20px; font-weight: 500; line-height: 1; }
        .card-sub { font-size: 11px; color: var(--text-muted); margin-top: 4px; font-family: var(--mono); }
        .card-sub.positive { color: #3B6D11; }
        .card-sub.negative { color: #A32D2D; }
        .card-threshold { font-size: 10px; margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); font-family: var(--mono); }

        .skeleton { background: var(--border); border-radius: 4px; animation: shimmer 1.4s ease-in-out infinite; }
        @keyframes shimmer { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .sk-val { height: 20px; width: 60%; margin-bottom: 4px; }
        .sk-sub { height: 11px; width: 40%; }

        .error-note { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }

        .footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 0.5px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: gap; }
        .footer-note { font-size: 11px; color: var(--text-muted); font-family: var(--mono); }

        @media (max-width: 480px) {
          .grid { grid-template-columns: 1fr 1fr; }
          .card-value { font-size: 18px; }
        }
      `}</style>

      <div className="page">
        <div className="topbar">
          <div className="wordmark">macro<span>monitor</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {!loading && !error && (
              <span className={`pill pill-${overallStatus}`}>
                <span
                  className={`dot ${overallStatus !== 'ok' ? 'dot-pulse' : ''}`}
                  style={{ background: STATUS_STYLES[overallStatus].dot }}
                />
                {overallLabel}
              </span>
            )}
            {fetchedTime && <span className="meta">{fetchedTime}</span>}
          </div>
        </div>

        {error && (
          <p className="error-note">Could not fetch data. Check your FRED_API_KEY and try again.</p>
        )}

        {SECTIONS.map(section => (
          <div className="section" key={section.label}>
            <div className="section-label">{section.label}</div>
            <div className="grid">
              {section.keys.map(key => {
                const indicator = INDICATORS.find(i => i.key === key)!
                const value = data ? getValueForKey(data, key) : null
                const status: AlertStatus = value != null ? getStatus(indicator, value) : 'ok'
                const styles = STATUS_STYLES[status]
                const formatted = formatValue(key, value)
                const sub = data ? getSubLabel(key, data) : ''

                const cardStyle: React.CSSProperties = status !== 'ok'
                  ? { borderColor: styles.border, background: styles.bg }
                  : {}

                const thresholdText = indicator.alertAbove != null
                  ? `alert ↑ ${indicator.alertAbove}${indicator.unit}`
                  : indicator.alertBelow != null
                  ? `alert ↓ ${indicator.alertBelow}${indicator.unit}`
                  : null

                return (
                  <div className="card" key={key} style={cardStyle}>
                    <div className="card-top">
                      <span className="card-label">
                        <span
                          className={`dot ${status !== 'ok' ? 'dot-pulse' : ''}`}
                          style={{ background: styles.dot }}
                        />
                        {indicator.label}
                      </span>
                    </div>

                    {loading ? (
                      <>
                        <div className="skeleton sk-val" />
                        <div className="skeleton sk-sub" />
                      </>
                    ) : (
                      <>
                        <div className="card-value" style={{ color: styles.value }}>
                          {formatted}
                        </div>
                        {sub && (
                          <div className={`card-sub ${
                            sub.startsWith('+') ? 'positive' :
                            sub.startsWith('-') ? 'negative' : ''
                          }`}>
                            {sub}
                          </div>
                        )}
                        {thresholdText && (
                          <div className="card-threshold" style={{ color: styles.note }}>
                            {thresholdText}
                          </div>
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
          <span className="footer-note">
            Data: FRED API · Yahoo Finance · Updates every 15 min
          </span>
          <span className="footer-note">
            Alerts: email · SMS · in-app
          </span>
        </div>
      </div>
    </>
  )
}
