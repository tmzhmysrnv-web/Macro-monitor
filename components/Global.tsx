// components/Global.tsx
// Global-risk intelligence view — a global early-warning system, not a news
// feed. Answers "are global forces creating new risks for the economy?":
//   Status → Summary → What The World Is Experiencing → Risk/Stabilizer →
//   Key Drivers → Recent Alerts → Watching
import { useEffect, useState } from 'react'
import Icon, { STATUS_ICON } from './Icon'
import DriverMetricCard, { type MetricCardData } from './DriverMetricCard'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCardData[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type Callout = { text: string; why: string; key: string }
type GlobalResponse = {
  available: boolean
  status: { emoji: string; label: string; tone: Tone }
  subtitle: string
  summary: string
  experiencing: { tone: Tone; text: string }
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

export default function Global({ initialData = null }: { initialData?: GlobalResponse | null }) {
  const [gl, setGl] = useState<GlobalResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    if (gl) return
    fetch('/api/global')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setGl(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [gl])

  useEffect(() => {
    if (initialData && !gl) { setGl(initialData); setLoading(false) }
  }, [initialData, gl])

  // Click a risk/stabilizer callout → open + scroll to its Key Driver.
  function goToDriver(key: string) {
    if (!key) return
    setOpenCat(key)
    setTimeout(() => document.getElementById(`gl-drv-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  if (error) return <div className="gl-error">Could not load global data. Try refreshing.</div>

  if (gl && !gl.available) {
    return (
      <div>
        <div className="gl-hero gl-unavail">
          <div className="gl-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="gl-badge-emoji"><Icon name="circle" size={20} /></span> Data Unavailable
          </div>
          <p className="gl-summary">{gl.subtitle} The data source is rate-limited or briefly down — refresh in a minute.</p>
        </div>
        <Styles />
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Global Status + 2. Summary ── */}
      <div className="gl-hero">
        {loading || !gl ? (
          <>
            <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '60%' }} />
          </>
        ) : (
          <>
            <div className="gl-eyebrow">Are global forces creating new risks for the economy?</div>
            <div className="gl-badge" style={{ color: TONE_COLORS[gl.status.tone] }}>
              <span className="gl-badge-emoji"><Icon name="globe" size={22} /></span> {gl.status.label}
            </div>
            {gl.subtitle && <div className="gl-subtitle">{gl.subtitle}</div>}
            <p className="gl-summary">{gl.summary}</p>
          </>
        )}
      </div>

      {/* ── 3. What The World Is Experiencing ── */}
      {gl && gl.experiencing && (
        <div className="gl-exp" style={{ borderColor: TONE_COLORS[gl.experiencing.tone], background: TONE_BG[gl.experiencing.tone] }}>
          <span className="gl-exp-label">What the world is experiencing</span>
          <span className="gl-exp-text" style={{ color: TONE_COLORS[gl.experiencing.tone] }}>
            <Icon name={STATUS_ICON[gl.experiencing.tone]} size={13} style={{ display: 'inline-block', verticalAlign: -2, marginRight: 4 }} />{gl.experiencing.text}
          </span>
        </div>
      )}

      {/* ── 4. Biggest risk / biggest stabilizer (click → its driver) ── */}
      {gl && (
        <div className="gl-callouts">
          <div className="gl-callout gl-callout-risk" role="button" tabIndex={0}
            onClick={() => goToDriver(gl.risk.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(gl.risk.key) }}>
            <div className="gl-callout-label">▲ Biggest risk {gl.risk.key && <span className="gl-callout-go">see driver →</span>}</div>
            <div className="gl-callout-text">{gl.risk.text}</div>
            {gl.risk.why && <div className="gl-callout-why">{gl.risk.why}</div>}
          </div>
          <div className="gl-callout gl-callout-stab" role="button" tabIndex={0}
            onClick={() => goToDriver(gl.stabilizer.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(gl.stabilizer.key) }}>
            <div className="gl-callout-label">▼ Biggest stabilizer {gl.stabilizer.key && <span className="gl-callout-go">see driver →</span>}</div>
            <div className="gl-callout-text">{gl.stabilizer.text}</div>
            {gl.stabilizer.why && <div className="gl-callout-why">{gl.stabilizer.why}</div>}
          </div>
        </div>
      )}

      {/* ── 5. Key Drivers scorecard ── */}
      <div className="gl-section-label">Key drivers</div>
      <div className="gl-drivers">
        {(gl?.categories || []).map(cat => (
          <div
            key={cat.key}
            id={`gl-drv-${cat.key}`}
            className="gl-driver"
            role="button"
            tabIndex={0}
            onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
            onKeyDown={e => { if (e.key === 'Enter') setOpenCat(openCat === cat.key ? null : cat.key) }}
            title="Click for the underlying metrics"
          >
            <div className="gl-driver-top">
              <span className="gl-driver-label">
                {cat.label}<span className="gl-driver-caret">{openCat === cat.key ? '▾' : '▸'}</span>
              </span>
              <span className="gl-badge-pill" style={{ color: TONE_COLORS[cat.tone], background: TONE_BG[cat.tone] }}>
                <Icon name={STATUS_ICON[cat.tone]} size={12} style={{ display: 'inline-block', verticalAlign: -1.5, marginRight: 3 }} />{cat.status}
              </span>
            </div>
            <div className="gl-driver-bar">
              <div className="gl-driver-fill" style={{ width: `${Math.round(cat.fill * 100)}%`, background: TONE_COLORS[cat.tone] }} />
            </div>
            {openCat === cat.key && (
              <div className="gl-driver-detail">
                <div className="gl-metric-grid" onClick={e => e.stopPropagation()}>
                  {cat.metrics.map((m, i) => <DriverMetricCard key={i} m={m} />)}
                </div>
                <ul className="gl-driver-signals">
                  {cat.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && [1, 2, 3, 4].map(i => (
          <div key={i} className="gl-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── 6. Recent global alerts (never empty) ── */}
      <div className="gl-section-label">Recent global alerts</div>
      {gl && gl.alerts.length === 0 ? (
        <div className="gl-noalert">
          <div className="gl-noalert-line">No active global alerts.</div>
          {gl.lastAlert && <div className="gl-lastalert"><span>Last alert</span>{gl.lastAlert}</div>}
        </div>
      ) : (
        (gl?.alerts || []).map(a => (
          <div className="gl-alert" key={a.id}>
            <div className="gl-alert-title">⚠ {a.title}</div>
            <div className="gl-alert-row"><span>What happened</span>{a.what}</div>
            <div className="gl-alert-row"><span>Why it matters</span>{a.why}</div>
            <div className="gl-alert-row"><span>Affected systems</span>
              <div className="gl-chips">{a.affected.map(x => <span className="gl-chip" key={x}>{x}</span>)}</div>
            </div>
            <div className="gl-alert-row"><span>Historical context</span>{a.context}</div>
          </div>
        ))
      )}

      {/* ── 7. Watching closely (never empty) ── */}
      <div className="gl-section-label">Watching closely</div>
      <div className="gl-watch-note">Where external risk may emerge next — distance to each alert threshold.</div>
      {gl && gl.watching.length === 0 && (
        <div className="gl-empty">All key thresholds are comfortably clear right now.</div>
      )}
      {(gl?.watching || []).map(w => (
        <div className="gl-watch" key={w.label}>
          <div className="gl-watch-head">
            <span className="gl-watch-label"><Icon name={w.proximity > 0.7 ? 'flame' : 'alert-triangle'} size={13} style={{ display: 'inline-block', verticalAlign: -2, marginRight: 4, color: w.proximity > 0.7 ? 'var(--bad)' : 'var(--warn)' }} />{w.label}</span>
            <span className="gl-watch-text">{w.text}</span>
          </div>
          <div className="gl-watch-bar">
            <div className="gl-watch-fill" style={{
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
      .gl-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
      .gl-unavail { border-style: dashed; }
      .gl-eyebrow { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; }
      .gl-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .gl-badge-emoji { font-size: 24px; }
      .gl-subtitle { font-size: 13.5px; color: var(--text-primary); font-weight: 500; margin-bottom: 10px; }
      .gl-summary { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin: 0; max-width: 78ch; }

      .gl-exp { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; margin-bottom: 6px; }
      .gl-exp-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); }
      .gl-exp-text { font-size: 15px; font-weight: 600; }

      .gl-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .gl-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
      .gl-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .gl-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .gl-callout-risk:hover { background: rgba(226,75,74,0.1); }
      .gl-callout-stab:hover { background: rgba(99,153,34,0.1); }
      .gl-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .gl-callout-risk .gl-callout-label { color: #A32D2D; }
      .gl-callout-stab .gl-callout-label { color: #3B6D11; }
      .gl-callout-go { font-size: 9px; font-weight: 500; opacity: 0; letter-spacing: 0.02em; transition: opacity 0.15s; }
      .gl-callout:hover .gl-callout-go { opacity: 0.85; }
      .gl-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
      .gl-callout-why { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); }

      .gl-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .gl-drivers { display: flex; flex-direction: column; gap: 6px; }
      .gl-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .gl-driver:hover { border-color: var(--border-med); }
      .gl-driver-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .gl-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .gl-driver-caret { font-size: 9px; color: var(--text-muted); }
      .gl-badge-pill { font-size: 11px; font-weight: 600; font-family: var(--mono); padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
      .gl-driver-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 9px; }
      .gl-driver-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
      .gl-driver-detail { margin-top: 12px; }
      .gl-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
      .gl-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

      .gl-noalert { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; }
      .gl-noalert-line { font-size: 12.5px; color: var(--text-secondary); }
      .gl-lastalert { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); margin-top: 6px; display: flex; gap: 8px; }
      .gl-lastalert > span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
      .gl-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 6px 2px; }
      .gl-alert { background: var(--card-bg); border: 0.5px solid #EF9F27; border-radius: 8px; padding: 13px 15px; margin-bottom: 8px; }
      .gl-alert-title { font-size: 13.5px; font-weight: 600; color: #854F0B; margin-bottom: 8px; }
      .gl-alert-row { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 5px; display: flex; gap: 10px; }
      .gl-alert-row > span:first-child { flex: 0 0 120px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); padding-top: 2px; }
      .gl-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .gl-chip { font-size: 10.5px; font-family: var(--mono); background: var(--border); border-radius: 4px; padding: 2px 7px; color: var(--text-secondary); }

      .gl-watch-note { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
      .gl-watch { margin-bottom: 11px; }
      .gl-watch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 12px; }
      .gl-watch-label { font-size: 12.5px; color: var(--text-primary); }
      .gl-watch-text { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); text-align: right; }
      .gl-watch-bar { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .gl-watch-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

      .gl-error { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }
      @media (max-width: 520px) { .gl-callouts { grid-template-columns: 1fr; } .gl-alert-row { flex-direction: column; gap: 2px; } .gl-alert-row > span:first-child { flex: none; } }
    `}</style>
  )
}
