// components/Inflation.tsx
// Inflation intelligence view — an inflation early-warning system, not a CPI
// dashboard. Answers "is inflation getting better or worse?" via:
//   Status → Summary → Biggest Risk/Stabilizer → Key Drivers → Recent Alerts → Watching
import { useEffect, useState } from 'react'
import Icon, { STATUS_ICON } from './Icon'
import DriverMetricCard, { type MetricCardData } from './DriverMetricCard'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCardData[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type Callout = { text: string; why: string; key: string }
type InflationResponse = {
  available: boolean
  status: { emoji: string; label: string; tone: Tone }
  subtitle: string
  summary: string
  risk: Callout
  stabilizer: Callout
  categories: Category[]
  alerts: Alert[]
  lastAlert: string | null
  watching: WatchItem[]
  fetchedAt: string
}

const TONE_COLORS: Record<Tone, string> = {
  good: 'var(--good)', neutral: 'var(--neutral)', warn: 'var(--warn)', bad: 'var(--bad)', crisis: 'var(--crisis)',
}
const TONE_BG: Record<Tone, string> = {
  good: 'rgba(99,153,34,0.14)', neutral: 'rgba(158,158,46,0.16)', warn: 'rgba(186,117,23,0.16)',
  bad: 'rgba(226,75,74,0.15)', crisis: 'rgba(163,45,45,0.18)',
}

export default function Inflation({ initialData = null }: { initialData?: InflationResponse | null }) {
  const [inf, setInf] = useState<InflationResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    if (inf) return
    fetch('/api/inflation')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setInf(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [inf])

  useEffect(() => {
    if (initialData && !inf) { setInf(initialData); setLoading(false) }
  }, [initialData, inf])

  // Click a risk/stabilizer callout → open + scroll to its Key Driver.
  function goToDriver(key: string) {
    if (!key) return
    setOpenCat(key)
    setTimeout(() => document.getElementById(`inf-drv-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  if (error) return <div className="inf-error">Could not load inflation data. Try refreshing.</div>

  if (inf && !inf.available) {
    return (
      <div>
        <div className="inf-hero inf-unavail">
          <div className="inf-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="inf-badge-emoji"><Icon name="circle" size={20} /></span> Data Unavailable
          </div>
          <p className="inf-summary">{inf.subtitle} The data source is rate-limited or briefly down — refresh in a minute.</p>
        </div>
        <Styles />
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Inflation Status + 2. Summary ── */}
      <div className="inf-hero">
        {loading || !inf ? (
          <>
            <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '60%' }} />
          </>
        ) : (
          <>
            <div className="inf-eyebrow">Is inflation getting better or worse?</div>
            <div className="inf-badge" style={{ color: TONE_COLORS[inf.status.tone] }}>
              <span className="inf-badge-emoji"><Icon name="flame" size={22} /></span> {inf.status.label}
            </div>
            {inf.subtitle && <div className="inf-subtitle">{inf.subtitle}</div>}
            <p className="inf-summary">{inf.summary}</p>
          </>
        )}
      </div>

      {/* ── 3. Biggest risk / biggest stabilizer (click → its driver) ── */}
      {inf && (
        <div className="inf-callouts">
          <div className="inf-callout inf-callout-risk" role="button" tabIndex={0}
            onClick={() => goToDriver(inf.risk.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(inf.risk.key) }}>
            <div className="inf-callout-label">▲ Biggest risk {inf.risk.key && <span className="inf-callout-go">see driver →</span>}</div>
            <div className="inf-callout-text">{inf.risk.text}</div>
            {inf.risk.why && <div className="inf-callout-why">{inf.risk.why}</div>}
          </div>
          <div className="inf-callout inf-callout-stab" role="button" tabIndex={0}
            onClick={() => goToDriver(inf.stabilizer.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(inf.stabilizer.key) }}>
            <div className="inf-callout-label">▼ Biggest stabilizer {inf.stabilizer.key && <span className="inf-callout-go">see driver →</span>}</div>
            <div className="inf-callout-text">{inf.stabilizer.text}</div>
            {inf.stabilizer.why && <div className="inf-callout-why">{inf.stabilizer.why}</div>}
          </div>
        </div>
      )}

      {/* ── 4. Key Drivers scorecard ── */}
      <div className="inf-section-label">Key drivers</div>
      <div className="inf-drivers">
        {(inf?.categories || []).map(cat => (
          <div
            key={cat.key}
            id={`inf-drv-${cat.key}`}
            className="inf-driver"
            role="button"
            tabIndex={0}
            onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
            onKeyDown={e => { if (e.key === 'Enter') setOpenCat(openCat === cat.key ? null : cat.key) }}
            title="Click for the underlying metrics"
          >
            <div className="inf-driver-top">
              <span className="inf-driver-label">
                {cat.label}<span className="inf-driver-caret">{openCat === cat.key ? '▾' : '▸'}</span>
              </span>
              <span className="inf-badge-pill" style={{ color: TONE_COLORS[cat.tone], background: TONE_BG[cat.tone] }}>
                <Icon name={STATUS_ICON[cat.tone]} size={12} style={{ display: 'inline-block', verticalAlign: -1.5, marginRight: 3 }} />{cat.status}
              </span>
            </div>
            <div className="inf-driver-bar">
              <div className="inf-driver-fill" style={{ width: `${Math.round(cat.fill * 100)}%`, background: TONE_COLORS[cat.tone] }} />
            </div>
            {openCat === cat.key && (
              <div className="inf-driver-detail">
                <div className="inf-metric-grid" onClick={e => e.stopPropagation()}>
                  {cat.metrics.map((m, i) => <DriverMetricCard key={i} m={m} />)}
                </div>
                <ul className="inf-driver-signals">
                  {cat.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && [1, 2, 3, 4].map(i => (
          <div key={i} className="inf-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── 5. Recent inflation alerts (never empty) ── */}
      <div className="inf-section-label">Recent inflation alerts</div>
      {inf && inf.alerts.length === 0 ? (
        <div className="inf-noalert">
          <div className="inf-noalert-line">No active inflation alerts.</div>
          {inf.lastAlert && <div className="inf-lastalert"><span>Last alert</span>{inf.lastAlert}</div>}
        </div>
      ) : (
        (inf?.alerts || []).map(a => (
          <div className="inf-alert" key={a.id}>
            <div className="inf-alert-title">⚠ {a.title}</div>
            <div className="inf-alert-row"><span>What happened</span>{a.what}</div>
            <div className="inf-alert-row"><span>Why it matters</span>{a.why}</div>
            <div className="inf-alert-row"><span>Affected systems</span>
              <div className="inf-chips">{a.affected.map(x => <span className="inf-chip" key={x}>{x}</span>)}</div>
            </div>
            <div className="inf-alert-row"><span>Historical context</span>{a.context}</div>
          </div>
        ))
      )}

      {/* ── 6. Watching closely (never empty) ── */}
      <div className="inf-section-label">Watching closely</div>
      <div className="inf-watch-note">Where inflation pressure may emerge next — distance to each alert threshold.</div>
      {inf && inf.watching.length === 0 && (
        <div className="inf-empty">All key thresholds are comfortably clear right now.</div>
      )}
      {(inf?.watching || []).map(w => (
        <div className="inf-watch" key={w.label}>
          <div className="inf-watch-head">
            <span className="inf-watch-label"><Icon name={w.proximity > 0.7 ? 'flame' : 'alert-triangle'} size={13} style={{ display: 'inline-block', verticalAlign: -2, marginRight: 4, color: w.proximity > 0.7 ? 'var(--bad)' : 'var(--warn)' }} />{w.label}</span>
            <span className="inf-watch-text">{w.text}</span>
          </div>
          <div className="inf-watch-bar">
            <div className="inf-watch-fill" style={{
              width: `${Math.round(w.proximity * 100)}%`,
              background: w.proximity > 0.85 ? '#E24B4A' : w.proximity > 0.6 ? '#BA7517' : '#639922',
            }} />
          </div>
        </div>
      ))}

      <Styles />
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .inf-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
      .inf-unavail { border-style: dashed; }
      .inf-eyebrow { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; }
      .inf-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .inf-badge-emoji { font-size: 24px; }
      .inf-subtitle { font-size: 13.5px; color: var(--text-primary); font-weight: 500; margin-bottom: 10px; }
      .inf-summary { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin: 0; max-width: 78ch; }

      .inf-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .inf-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
      .inf-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .inf-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .inf-callout-risk:hover { background: rgba(226,75,74,0.1); }
      .inf-callout-stab:hover { background: rgba(99,153,34,0.1); }
      .inf-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .inf-callout-risk .inf-callout-label { color: #A32D2D; }
      .inf-callout-stab .inf-callout-label { color: #3B6D11; }
      .inf-callout-go { font-size: 9px; font-weight: 500; opacity: 0; letter-spacing: 0.02em; transition: opacity 0.15s; }
      .inf-callout:hover .inf-callout-go { opacity: 0.85; }
      .inf-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
      .inf-callout-why { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); }

      .inf-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .inf-drivers { display: flex; flex-direction: column; gap: 6px; }
      .inf-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .inf-driver:hover { border-color: var(--border-med); }
      .inf-driver-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .inf-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .inf-driver-caret { font-size: 9px; color: var(--text-muted); }
      .inf-badge-pill { font-size: 11px; font-weight: 600; font-family: var(--mono); padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
      .inf-driver-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 9px; }
      .inf-driver-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
      .inf-driver-detail { margin-top: 12px; }
      .inf-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
      .inf-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

      .inf-noalert { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; }
      .inf-noalert-line { font-size: 12.5px; color: var(--text-secondary); }
      .inf-lastalert { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); margin-top: 6px; display: flex; gap: 8px; }
      .inf-lastalert > span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
      .inf-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 6px 2px; }
      .inf-alert { background: var(--card-bg); border: 0.5px solid #EF9F27; border-radius: 8px; padding: 13px 15px; margin-bottom: 8px; }
      .inf-alert-title { font-size: 13.5px; font-weight: 600; color: #854F0B; margin-bottom: 8px; }
      .inf-alert-row { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 5px; display: flex; gap: 10px; }
      .inf-alert-row > span:first-child { flex: 0 0 120px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); padding-top: 2px; }
      .inf-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .inf-chip { font-size: 10.5px; font-family: var(--mono); background: var(--border); border-radius: 4px; padding: 2px 7px; color: var(--text-secondary); }

      .inf-watch-note { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
      .inf-watch { margin-bottom: 11px; }
      .inf-watch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 12px; }
      .inf-watch-label { font-size: 12.5px; color: var(--text-primary); }
      .inf-watch-text { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); text-align: right; }
      .inf-watch-bar { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .inf-watch-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

      .inf-error { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }
      @media (max-width: 520px) { .inf-callouts { grid-template-columns: 1fr; } .inf-alert-row { flex-direction: column; gap: 2px; } .inf-alert-row > span:first-child { flex: none; } }
    `}</style>
  )
}
