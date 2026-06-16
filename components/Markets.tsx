// components/Markets.tsx
// Markets intelligence view — an investor-confidence and risk-appetite monitor,
// not a stock dashboard. Answers "what level of risk are investors willing to
// take?":
//   Status → Summary → What Investors Are Doing → Risk/Stabilizer →
//   Key Drivers → Recent Alerts → Watching
import { useEffect, useState } from 'react'
import Icon, { STATUS_ICON } from './Icon'
import DriverMetricCard, { type MetricCardData } from './DriverMetricCard'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCardData[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type Callout = { text: string; why: string; key: string }
type MarketsResponse = {
  available: boolean
  status: { emoji: string; label: string; tone: Tone }
  subtitle: string
  summary: string
  doing: { tone: Tone; text: string }
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

export default function Markets({ initialData = null }: { initialData?: MarketsResponse | null }) {
  const [mk, setMk] = useState<MarketsResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    if (mk) return
    fetch('/api/markets')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setMk(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [mk])

  useEffect(() => {
    if (initialData && !mk) { setMk(initialData); setLoading(false) }
  }, [initialData, mk])

  // Click a risk/stabilizer callout → open + scroll to its Key Driver.
  function goToDriver(key: string) {
    if (!key) return
    setOpenCat(key)
    setTimeout(() => document.getElementById(`mk-drv-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  if (error) return <div className="mk-error">Could not load market data. Try refreshing.</div>

  if (mk && !mk.available) {
    return (
      <div>
        <div className="mk-hero mk-unavail">
          <div className="mk-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="mk-badge-emoji"><Icon name="circle" size={20} /></span> Data Unavailable
          </div>
          <p className="mk-summary">{mk.subtitle} The data source is rate-limited or briefly down — refresh in a minute.</p>
        </div>
        <Styles />
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Markets Status + 2. Summary ── */}
      <div className="mk-hero">
        {loading || !mk ? (
          <>
            <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '60%' }} />
          </>
        ) : (
          <>
            <div className="mk-eyebrow">What level of risk are investors willing to take?</div>
            <div className="mk-badge" style={{ color: TONE_COLORS[mk.status.tone] }}>
              <span className="mk-badge-emoji"><Icon name="activity" size={22} /></span> {mk.status.label}
            </div>
            {mk.subtitle && <div className="mk-subtitle">{mk.subtitle}</div>}
            <p className="mk-summary">{mk.summary}</p>
          </>
        )}
      </div>

      {/* ── 3. What Investors Are Doing ── */}
      {mk && mk.doing && (
        <div className="mk-doing" style={{ borderColor: TONE_COLORS[mk.doing.tone], background: TONE_BG[mk.doing.tone] }}>
          <span className="mk-doing-label">What investors are doing</span>
          <span className="mk-doing-text" style={{ color: TONE_COLORS[mk.doing.tone] }}>
            <Icon name={STATUS_ICON[mk.doing.tone]} size={13} style={{ display: 'inline-block', verticalAlign: -2, marginRight: 4 }} />{mk.doing.text}
          </span>
        </div>
      )}

      {/* ── 4. Biggest risk / biggest stabilizer (click → its driver) ── */}
      {mk && (
        <div className="mk-callouts">
          <div className="mk-callout mk-callout-risk" role="button" tabIndex={0}
            onClick={() => goToDriver(mk.risk.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(mk.risk.key) }}>
            <div className="mk-callout-label">▲ Biggest risk {mk.risk.key && <span className="mk-callout-go">see driver →</span>}</div>
            <div className="mk-callout-text">{mk.risk.text}</div>
            {mk.risk.why && <div className="mk-callout-why">{mk.risk.why}</div>}
          </div>
          <div className="mk-callout mk-callout-stab" role="button" tabIndex={0}
            onClick={() => goToDriver(mk.stabilizer.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(mk.stabilizer.key) }}>
            <div className="mk-callout-label">▼ Biggest stabilizer {mk.stabilizer.key && <span className="mk-callout-go">see driver →</span>}</div>
            <div className="mk-callout-text">{mk.stabilizer.text}</div>
            {mk.stabilizer.why && <div className="mk-callout-why">{mk.stabilizer.why}</div>}
          </div>
        </div>
      )}

      {/* ── 5. Key Drivers scorecard ── */}
      <div className="mk-section-label">Key drivers</div>
      <div className="mk-drivers">
        {(mk?.categories || []).map(cat => (
          <div
            key={cat.key}
            id={`mk-drv-${cat.key}`}
            className="mk-driver"
            role="button"
            tabIndex={0}
            onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
            onKeyDown={e => { if (e.key === 'Enter') setOpenCat(openCat === cat.key ? null : cat.key) }}
            title="Click for the underlying metrics"
          >
            <div className="mk-driver-top">
              <span className="mk-driver-label">
                {cat.label}<span className="mk-driver-caret">{openCat === cat.key ? '▾' : '▸'}</span>
              </span>
              <span className="mk-badge-pill" style={{ color: TONE_COLORS[cat.tone], background: TONE_BG[cat.tone] }}>
                <Icon name={STATUS_ICON[cat.tone]} size={12} style={{ display: 'inline-block', verticalAlign: -1.5, marginRight: 3 }} />{cat.status}
              </span>
            </div>
            <div className="mk-driver-bar">
              <div className="mk-driver-fill" style={{ width: `${Math.round(cat.fill * 100)}%`, background: TONE_COLORS[cat.tone] }} />
            </div>
            {openCat === cat.key && (
              <div className="mk-driver-detail">
                <div className="mk-metric-grid" onClick={e => e.stopPropagation()}>
                  {cat.metrics.map((m, i) => <DriverMetricCard key={i} m={m} />)}
                </div>
                <ul className="mk-driver-signals">
                  {cat.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && [1, 2, 3, 4].map(i => (
          <div key={i} className="mk-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── 6. Recent market alerts (never empty) ── */}
      <div className="mk-section-label">Recent market alerts</div>
      {mk && mk.alerts.length === 0 ? (
        <div className="mk-noalert">
          <div className="mk-noalert-line">No active market alerts.</div>
          {mk.lastAlert && <div className="mk-lastalert"><span>Last alert</span>{mk.lastAlert}</div>}
        </div>
      ) : (
        (mk?.alerts || []).map(a => (
          <div className="mk-alert" key={a.id}>
            <div className="mk-alert-title">⚠ {a.title}</div>
            <div className="mk-alert-row"><span>What happened</span>{a.what}</div>
            <div className="mk-alert-row"><span>Why it matters</span>{a.why}</div>
            <div className="mk-alert-row"><span>Affected systems</span>
              <div className="mk-chips">{a.affected.map(x => <span className="mk-chip" key={x}>{x}</span>)}</div>
            </div>
            <div className="mk-alert-row"><span>Historical context</span>{a.context}</div>
          </div>
        ))
      )}

      {/* ── 7. Watching closely (never empty) ── */}
      <div className="mk-section-label">Watching closely</div>
      <div className="mk-watch-note">Where investor confidence may weaken next — distance to each alert threshold.</div>
      {mk && mk.watching.length === 0 && (
        <div className="mk-empty">All key thresholds are comfortably clear right now.</div>
      )}
      {(mk?.watching || []).map(w => (
        <div className="mk-watch" key={w.label}>
          <div className="mk-watch-head">
            <span className="mk-watch-label"><Icon name={w.proximity > 0.7 ? 'flame' : 'alert-triangle'} size={13} style={{ display: 'inline-block', verticalAlign: -2, marginRight: 4, color: w.proximity > 0.7 ? 'var(--bad)' : 'var(--warn)' }} />{w.label}</span>
            <span className="mk-watch-text">{w.text}</span>
          </div>
          <div className="mk-watch-bar">
            <div className="mk-watch-fill" style={{
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
      .mk-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
      .mk-unavail { border-style: dashed; }
      .mk-eyebrow { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; }
      .mk-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .mk-badge-emoji { font-size: 24px; }
      .mk-subtitle { font-size: 13.5px; color: var(--text-primary); font-weight: 500; margin-bottom: 10px; }
      .mk-summary { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin: 0; max-width: 78ch; }

      .mk-doing { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; margin-bottom: 6px; }
      .mk-doing-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); }
      .mk-doing-text { font-size: 15px; font-weight: 600; }

      .mk-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .mk-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
      .mk-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .mk-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .mk-callout-risk:hover { background: rgba(226,75,74,0.1); }
      .mk-callout-stab:hover { background: rgba(99,153,34,0.1); }
      .mk-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .mk-callout-risk .mk-callout-label { color: #A32D2D; }
      .mk-callout-stab .mk-callout-label { color: #3B6D11; }
      .mk-callout-go { font-size: 9px; font-weight: 500; opacity: 0; letter-spacing: 0.02em; transition: opacity 0.15s; }
      .mk-callout:hover .mk-callout-go { opacity: 0.85; }
      .mk-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
      .mk-callout-why { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); }

      .mk-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .mk-drivers { display: flex; flex-direction: column; gap: 6px; }
      .mk-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .mk-driver:hover { border-color: var(--border-med); }
      .mk-driver-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .mk-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .mk-driver-caret { font-size: 9px; color: var(--text-muted); }
      .mk-badge-pill { font-size: 11px; font-weight: 600; font-family: var(--mono); padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
      .mk-driver-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 9px; }
      .mk-driver-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
      .mk-driver-detail { margin-top: 12px; }
      .mk-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
      .mk-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

      .mk-noalert { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; }
      .mk-noalert-line { font-size: 12.5px; color: var(--text-secondary); }
      .mk-lastalert { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); margin-top: 6px; display: flex; gap: 8px; }
      .mk-lastalert > span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
      .mk-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 6px 2px; }
      .mk-alert { background: var(--card-bg); border: 0.5px solid #EF9F27; border-radius: 8px; padding: 13px 15px; margin-bottom: 8px; }
      .mk-alert-title { font-size: 13.5px; font-weight: 600; color: #854F0B; margin-bottom: 8px; }
      .mk-alert-row { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 5px; display: flex; gap: 10px; }
      .mk-alert-row > span:first-child { flex: 0 0 120px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); padding-top: 2px; }
      .mk-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .mk-chip { font-size: 10.5px; font-family: var(--mono); background: var(--border); border-radius: 4px; padding: 2px 7px; color: var(--text-secondary); }

      .mk-watch-note { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
      .mk-watch { margin-bottom: 11px; }
      .mk-watch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 12px; }
      .mk-watch-label { font-size: 12.5px; color: var(--text-primary); }
      .mk-watch-text { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); text-align: right; }
      .mk-watch-bar { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .mk-watch-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

      .mk-error { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }
      @media (max-width: 520px) { .mk-callouts { grid-template-columns: 1fr; } .mk-alert-row { flex-direction: column; gap: 2px; } .mk-alert-row > span:first-child { flex: none; } }
    `}</style>
  )
}
