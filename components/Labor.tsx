// components/Labor.tsx
// Labor-market intelligence view — an employment early-warning system, not a
// statistics dashboard. Answers "is the job market strengthening or weakening?":
//   Status → Summary → Workers Are Experiencing → Risk/Stabilizer →
//   Key Drivers → Recent Alerts → Watching
import { useEffect, useState } from 'react'
import DriverMetricCard, { type MetricCardData } from './DriverMetricCard'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCardData[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type Callout = { text: string; why: string; key: string }
type LaborResponse = {
  available: boolean
  status: { emoji: string; label: string; tone: Tone }
  subtitle: string
  summary: string
  experience: { tone: Tone; text: string }
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
const TONE_DOT: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }

export default function Labor({ initialData = null }: { initialData?: LaborResponse | null }) {
  const [lb, setLb] = useState<LaborResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    if (lb) return
    fetch('/api/labor')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setLb(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [lb])

  useEffect(() => {
    if (initialData && !lb) { setLb(initialData); setLoading(false) }
  }, [initialData, lb])

  // Click a risk/stabilizer callout → open + scroll to its Key Driver.
  function goToDriver(key: string) {
    if (!key) return
    setOpenCat(key)
    setTimeout(() => document.getElementById(`lb-drv-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  if (error) return <div className="lb-error">Could not load labor-market data. Try refreshing.</div>

  if (lb && !lb.available) {
    return (
      <div>
        <div className="lb-hero lb-unavail">
          <div className="lb-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="lb-badge-emoji">⚪</span> Data Unavailable
          </div>
          <p className="lb-summary">{lb.subtitle} The data source is rate-limited or briefly down — refresh in a minute.</p>
        </div>
        <Styles />
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Labor Status + 2. Summary ── */}
      <div className="lb-hero">
        {loading || !lb ? (
          <>
            <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '60%' }} />
          </>
        ) : (
          <>
            <div className="lb-eyebrow">Is the job market strengthening or weakening?</div>
            <div className="lb-badge" style={{ color: TONE_COLORS[lb.status.tone] }}>
              <span className="lb-badge-emoji">{lb.status.emoji}</span> {lb.status.label}
            </div>
            {lb.subtitle && <div className="lb-subtitle">{lb.subtitle}</div>}
            <p className="lb-summary">{lb.summary}</p>
          </>
        )}
      </div>

      {/* ── 3. Workers Are Experiencing ── */}
      {lb && lb.experience && (
        <div className="lb-exp" style={{ borderColor: TONE_COLORS[lb.experience.tone], background: TONE_BG[lb.experience.tone] }}>
          <span className="lb-exp-label">Workers are experiencing</span>
          <span className="lb-exp-text" style={{ color: TONE_COLORS[lb.experience.tone] }}>
            {TONE_DOT[lb.experience.tone]} {lb.experience.text}
          </span>
        </div>
      )}

      {/* ── 4. Biggest risk / biggest stabilizer (click → its driver) ── */}
      {lb && (
        <div className="lb-callouts">
          <div className="lb-callout lb-callout-risk" role="button" tabIndex={0}
            onClick={() => goToDriver(lb.risk.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(lb.risk.key) }}>
            <div className="lb-callout-label">▲ Biggest risk {lb.risk.key && <span className="lb-callout-go">see driver →</span>}</div>
            <div className="lb-callout-text">{lb.risk.text}</div>
            {lb.risk.why && <div className="lb-callout-why">{lb.risk.why}</div>}
          </div>
          <div className="lb-callout lb-callout-stab" role="button" tabIndex={0}
            onClick={() => goToDriver(lb.stabilizer.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(lb.stabilizer.key) }}>
            <div className="lb-callout-label">▼ Biggest stabilizer {lb.stabilizer.key && <span className="lb-callout-go">see driver →</span>}</div>
            <div className="lb-callout-text">{lb.stabilizer.text}</div>
            {lb.stabilizer.why && <div className="lb-callout-why">{lb.stabilizer.why}</div>}
          </div>
        </div>
      )}

      {/* ── 5. Key Drivers scorecard ── */}
      <div className="lb-section-label">Key drivers</div>
      <div className="lb-drivers">
        {(lb?.categories || []).map(cat => (
          <div
            key={cat.key}
            id={`lb-drv-${cat.key}`}
            className="lb-driver"
            role="button"
            tabIndex={0}
            onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
            onKeyDown={e => { if (e.key === 'Enter') setOpenCat(openCat === cat.key ? null : cat.key) }}
            title="Click for the underlying metrics"
          >
            <div className="lb-driver-top">
              <span className="lb-driver-label">
                {cat.label}<span className="lb-driver-caret">{openCat === cat.key ? '▾' : '▸'}</span>
              </span>
              <span className="lb-badge-pill" style={{ color: TONE_COLORS[cat.tone], background: TONE_BG[cat.tone] }}>
                {TONE_DOT[cat.tone]} {cat.status}
              </span>
            </div>
            <div className="lb-driver-bar">
              <div className="lb-driver-fill" style={{ width: `${Math.round(cat.fill * 100)}%`, background: TONE_COLORS[cat.tone] }} />
            </div>
            {openCat === cat.key && (
              <div className="lb-driver-detail">
                <div className="lb-metric-grid" onClick={e => e.stopPropagation()}>
                  {cat.metrics.map((m, i) => <DriverMetricCard key={i} m={m} />)}
                </div>
                <ul className="lb-driver-signals">
                  {cat.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && [1, 2, 3, 4].map(i => (
          <div key={i} className="lb-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── 6. Recent labor alerts (never empty) ── */}
      <div className="lb-section-label">Recent labor alerts</div>
      {lb && lb.alerts.length === 0 ? (
        <div className="lb-noalert">
          <div className="lb-noalert-line">No active labor-market alerts.</div>
          {lb.lastAlert && <div className="lb-lastalert"><span>Last alert</span>{lb.lastAlert}</div>}
        </div>
      ) : (
        (lb?.alerts || []).map(a => (
          <div className="lb-alert" key={a.id}>
            <div className="lb-alert-title">⚠ {a.title}</div>
            <div className="lb-alert-row"><span>What happened</span>{a.what}</div>
            <div className="lb-alert-row"><span>Why it matters</span>{a.why}</div>
            <div className="lb-alert-row"><span>Affected systems</span>
              <div className="lb-chips">{a.affected.map(x => <span className="lb-chip" key={x}>{x}</span>)}</div>
            </div>
            <div className="lb-alert-row"><span>Historical context</span>{a.context}</div>
          </div>
        ))
      )}

      {/* ── 7. Watching closely (never empty) ── */}
      <div className="lb-section-label">Watching closely</div>
      <div className="lb-watch-note">Where labor-market weakness may emerge next — distance to each alert threshold.</div>
      {lb && lb.watching.length === 0 && (
        <div className="lb-empty">All key thresholds are comfortably clear right now.</div>
      )}
      {(lb?.watching || []).map(w => (
        <div className="lb-watch" key={w.label}>
          <div className="lb-watch-head">
            <span className="lb-watch-label">{w.proximity > 0.7 ? '🔥' : '⚠️'} {w.label}</span>
            <span className="lb-watch-text">{w.text}</span>
          </div>
          <div className="lb-watch-bar">
            <div className="lb-watch-fill" style={{
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
      .lb-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
      .lb-unavail { border-style: dashed; }
      .lb-eyebrow { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; }
      .lb-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .lb-badge-emoji { font-size: 24px; }
      .lb-subtitle { font-size: 13.5px; color: var(--text-primary); font-weight: 500; margin-bottom: 10px; }
      .lb-summary { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin: 0; max-width: 78ch; }

      .lb-exp { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; margin-bottom: 6px; }
      .lb-exp-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); }
      .lb-exp-text { font-size: 15px; font-weight: 600; }

      .lb-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .lb-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
      .lb-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .lb-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .lb-callout-risk:hover { background: rgba(226,75,74,0.1); }
      .lb-callout-stab:hover { background: rgba(99,153,34,0.1); }
      .lb-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .lb-callout-risk .lb-callout-label { color: #A32D2D; }
      .lb-callout-stab .lb-callout-label { color: #3B6D11; }
      .lb-callout-go { font-size: 9px; font-weight: 500; opacity: 0; letter-spacing: 0.02em; transition: opacity 0.15s; }
      .lb-callout:hover .lb-callout-go { opacity: 0.85; }
      .lb-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
      .lb-callout-why { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); }

      .lb-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .lb-drivers { display: flex; flex-direction: column; gap: 6px; }
      .lb-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .lb-driver:hover { border-color: var(--border-med); }
      .lb-driver-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .lb-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .lb-driver-caret { font-size: 9px; color: var(--text-muted); }
      .lb-badge-pill { font-size: 11px; font-weight: 600; font-family: var(--mono); padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
      .lb-driver-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 9px; }
      .lb-driver-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
      .lb-driver-detail { margin-top: 12px; }
      .lb-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
      .lb-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

      .lb-noalert { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; }
      .lb-noalert-line { font-size: 12.5px; color: var(--text-secondary); }
      .lb-lastalert { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); margin-top: 6px; display: flex; gap: 8px; }
      .lb-lastalert > span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
      .lb-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 6px 2px; }
      .lb-alert { background: var(--card-bg); border: 0.5px solid #EF9F27; border-radius: 8px; padding: 13px 15px; margin-bottom: 8px; }
      .lb-alert-title { font-size: 13.5px; font-weight: 600; color: #854F0B; margin-bottom: 8px; }
      .lb-alert-row { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 5px; display: flex; gap: 10px; }
      .lb-alert-row > span:first-child { flex: 0 0 120px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); padding-top: 2px; }
      .lb-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .lb-chip { font-size: 10.5px; font-family: var(--mono); background: var(--border); border-radius: 4px; padding: 2px 7px; color: var(--text-secondary); }

      .lb-watch-note { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
      .lb-watch { margin-bottom: 11px; }
      .lb-watch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 12px; }
      .lb-watch-label { font-size: 12.5px; color: var(--text-primary); }
      .lb-watch-text { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); text-align: right; }
      .lb-watch-bar { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .lb-watch-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

      .lb-error { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }
      @media (max-width: 520px) { .lb-callouts { grid-template-columns: 1fr; } .lb-alert-row { flex-direction: column; gap: 2px; } .lb-alert-row > span:first-child { flex: none; } }
    `}</style>
  )
}
