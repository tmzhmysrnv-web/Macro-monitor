// components/Credit.tsx
// Credit-market intelligence view — the economy's financial pulse monitor.
// Answers "are lenders becoming more fearful?" via:
//   Status → Summary → Biggest Risk/Stabilizer → Key Drivers → Recent Alerts → Watching
import { useEffect, useState } from 'react'
import DriverMetricCard, { type MetricCardData } from './DriverMetricCard'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCardData[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type Callout = { text: string; why: string; key: string }
type CreditResponse = {
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
  good: '#639922', neutral: '#9E9E2E', warn: '#BA7517', bad: '#E24B4A', crisis: '#A32D2D',
}
const TONE_BG: Record<Tone, string> = {
  good: 'rgba(99,153,34,0.14)', neutral: 'rgba(158,158,46,0.16)', warn: 'rgba(186,117,23,0.16)',
  bad: 'rgba(226,75,74,0.15)', crisis: 'rgba(163,45,45,0.18)',
}
const TONE_DOT: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }

export default function Credit({ initialData = null }: { initialData?: CreditResponse | null }) {
  const [c, setC] = useState<CreditResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    if (c) return
    fetch('/api/credit')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setC(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [c])

  useEffect(() => {
    if (initialData && !c) { setC(initialData); setLoading(false) }
  }, [initialData, c])

  // Click a risk/stabilizer callout → open + scroll to its Key Driver.
  function goToDriver(key: string) {
    if (!key) return
    setOpenCat(key)
    setTimeout(() => document.getElementById(`cr-drv-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  if (error) return <div className="cr-error">Could not load credit data. Try refreshing.</div>

  if (c && !c.available) {
    return (
      <div>
        <div className="cr-hero cr-unavail">
          <div className="cr-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="cr-badge-emoji">⚪</span> Data Unavailable
          </div>
          <p className="cr-summary">{c.subtitle} The data source is rate-limited or briefly down — refresh in a minute.</p>
        </div>
        <Styles />
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Credit Status + 2. Summary ── */}
      <div className="cr-hero">
        {loading || !c ? (
          <>
            <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '60%' }} />
          </>
        ) : (
          <>
            <div className="cr-eyebrow">Are lenders becoming more fearful?</div>
            <div className="cr-badge" style={{ color: TONE_COLORS[c.status.tone] }}>
              <span className="cr-badge-emoji">{c.status.emoji}</span> {c.status.label}
            </div>
            {c.subtitle && <div className="cr-subtitle">{c.subtitle}</div>}
            <p className="cr-summary">{c.summary}</p>
          </>
        )}
      </div>

      {/* ── 3. Biggest risk / biggest stabilizer (click → its driver) ── */}
      {c && (
        <div className="cr-callouts">
          <div className="cr-callout cr-callout-risk" role="button" tabIndex={0}
            onClick={() => goToDriver(c.risk.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(c.risk.key) }}>
            <div className="cr-callout-label">▲ Biggest risk {c.risk.key && <span className="cr-callout-go">see driver →</span>}</div>
            <div className="cr-callout-text">{c.risk.text}</div>
            {c.risk.why && <div className="cr-callout-why">{c.risk.why}</div>}
          </div>
          <div className="cr-callout cr-callout-stab" role="button" tabIndex={0}
            onClick={() => goToDriver(c.stabilizer.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(c.stabilizer.key) }}>
            <div className="cr-callout-label">▼ Biggest stabilizer {c.stabilizer.key && <span className="cr-callout-go">see driver →</span>}</div>
            <div className="cr-callout-text">{c.stabilizer.text}</div>
            {c.stabilizer.why && <div className="cr-callout-why">{c.stabilizer.why}</div>}
          </div>
        </div>
      )}

      {/* ── 4. Key Drivers scorecard ── */}
      <div className="cr-section-label">Key drivers</div>
      <div className="cr-drivers">
        {(c?.categories || []).map(cat => (
          <div
            key={cat.key}
            id={`cr-drv-${cat.key}`}
            className="cr-driver"
            role="button"
            tabIndex={0}
            onClick={() => setOpenCat(openCat === cat.key ? null : cat.key)}
            onKeyDown={e => { if (e.key === 'Enter') setOpenCat(openCat === cat.key ? null : cat.key) }}
            title="Click for the underlying metrics"
          >
            <div className="cr-driver-top">
              <span className="cr-driver-label">
                {cat.label}<span className="cr-driver-caret">{openCat === cat.key ? '▾' : '▸'}</span>
              </span>
              <span className="cr-badge-pill" style={{ color: TONE_COLORS[cat.tone], background: TONE_BG[cat.tone] }}>
                {TONE_DOT[cat.tone]} {cat.status}
              </span>
            </div>
            <div className="cr-driver-bar">
              <div className="cr-driver-fill" style={{ width: `${Math.round(cat.fill * 100)}%`, background: TONE_COLORS[cat.tone] }} />
            </div>
            {openCat === cat.key && (
              <div className="cr-driver-detail">
                <div className="cr-metric-grid" onClick={e => e.stopPropagation()}>
                  {cat.metrics.map((m, i) => <DriverMetricCard key={i} m={m} />)}
                </div>
                <ul className="cr-driver-signals">
                  {cat.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && [1, 2, 3, 4].map(i => (
          <div key={i} className="cr-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── 5. Recent credit alerts (never empty) ── */}
      <div className="cr-section-label">Recent credit alerts</div>
      {c && c.alerts.length === 0 ? (
        <div className="cr-noalert">
          <div className="cr-noalert-line">No active credit alerts.</div>
          {c.lastAlert && <div className="cr-lastalert"><span>Last alert</span>{c.lastAlert}</div>}
        </div>
      ) : (
        (c?.alerts || []).map(a => (
          <div className="cr-alert" key={a.id}>
            <div className="cr-alert-title">⚠ {a.title}</div>
            <div className="cr-alert-row"><span>What happened</span>{a.what}</div>
            <div className="cr-alert-row"><span>Why it matters</span>{a.why}</div>
            <div className="cr-alert-row"><span>Affected systems</span>
              <div className="cr-chips">{a.affected.map(x => <span className="cr-chip" key={x}>{x}</span>)}</div>
            </div>
            <div className="cr-alert-row"><span>Historical context</span>{a.context}</div>
          </div>
        ))
      )}

      {/* ── 6. Watching closely (never empty) ── */}
      <div className="cr-section-label">Watching closely</div>
      <div className="cr-watch-note">Where credit stress may emerge next — distance to each alert threshold.</div>
      {c && c.watching.length === 0 && (
        <div className="cr-empty">All key thresholds are comfortably clear right now.</div>
      )}
      {(c?.watching || []).map(w => (
        <div className="cr-watch" key={w.label}>
          <div className="cr-watch-head">
            <span className="cr-watch-label">{w.proximity > 0.7 ? '🔥' : '⚠️'} {w.label}</span>
            <span className="cr-watch-text">{w.text}</span>
          </div>
          <div className="cr-watch-bar">
            <div className="cr-watch-fill" style={{
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
      .cr-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
      .cr-unavail { border-style: dashed; }
      .cr-eyebrow { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; }
      .cr-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .cr-badge-emoji { font-size: 24px; }
      .cr-subtitle { font-size: 13.5px; color: var(--text-primary); font-weight: 500; margin-bottom: 10px; }
      .cr-summary { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin: 0; max-width: 78ch; }

      .cr-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .cr-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
      .cr-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .cr-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .cr-callout-risk:hover { background: rgba(226,75,74,0.1); }
      .cr-callout-stab:hover { background: rgba(99,153,34,0.1); }
      .cr-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .cr-callout-risk .cr-callout-label { color: #A32D2D; }
      .cr-callout-stab .cr-callout-label { color: #3B6D11; }
      .cr-callout-go { font-size: 9px; font-weight: 500; opacity: 0; letter-spacing: 0.02em; transition: opacity 0.15s; }
      .cr-callout:hover .cr-callout-go { opacity: 0.85; }
      .cr-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
      .cr-callout-why { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); }

      .cr-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .cr-drivers { display: flex; flex-direction: column; gap: 6px; }
      .cr-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .cr-driver:hover { border-color: var(--border-med); }
      .cr-driver-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .cr-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .cr-driver-caret { font-size: 9px; color: var(--text-muted); }
      .cr-badge-pill { font-size: 11px; font-weight: 600; font-family: var(--mono); padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
      .cr-driver-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 9px; }
      .cr-driver-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
      .cr-driver-detail { margin-top: 12px; }
      .cr-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
      .cr-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

      .cr-noalert { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; }
      .cr-noalert-line { font-size: 12.5px; color: var(--text-secondary); }
      .cr-lastalert { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); margin-top: 6px; display: flex; gap: 8px; }
      .cr-lastalert > span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
      .cr-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 6px 2px; }
      .cr-alert { background: var(--card-bg); border: 0.5px solid #EF9F27; border-radius: 8px; padding: 13px 15px; margin-bottom: 8px; }
      .cr-alert-title { font-size: 13.5px; font-weight: 600; color: #854F0B; margin-bottom: 8px; }
      .cr-alert-row { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 5px; display: flex; gap: 10px; }
      .cr-alert-row > span:first-child { flex: 0 0 120px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); padding-top: 2px; }
      .cr-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .cr-chip { font-size: 10.5px; font-family: var(--mono); background: var(--border); border-radius: 4px; padding: 2px 7px; color: var(--text-secondary); }

      .cr-watch-note { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
      .cr-watch { margin-bottom: 11px; }
      .cr-watch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 12px; }
      .cr-watch-label { font-size: 12.5px; color: var(--text-primary); }
      .cr-watch-text { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); text-align: right; }
      .cr-watch-bar { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .cr-watch-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

      .cr-foot { font-size: 10.5px; color: var(--text-muted); font-family: var(--mono); line-height: 1.6; margin-top: 1.6rem; padding-top: 10px; border-top: 0.5px solid var(--border); }
      .cr-error { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }
      @media (max-width: 520px) { .cr-callouts { grid-template-columns: 1fr; } .cr-alert-row { flex-direction: column; gap: 2px; } .cr-alert-row > span:first-child { flex: none; } }
    `}</style>
  )
}
