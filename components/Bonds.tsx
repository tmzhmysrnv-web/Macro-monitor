// components/Bonds.tsx
// Bond-market intelligence view — an economic early-warning radar, not a bond
// trading terminal. Answers "what are bond investors telling us?" via:
//   Status → Summary → Biggest Risk/Stabilizer → Key Drivers → Recent Alerts → Watching
import { useEffect, useState } from 'react'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type MetricCard = { label: string; value: string; sub?: string }
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCard[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type BondResponse = {
  available: boolean
  status: { emoji: string; label: string; tone: Tone }
  subtitle: string
  summary: string
  risk: string
  stabilizer: string
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

export default function Bonds() {
  const [b, setB] = useState<BondResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/bonds')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setB(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [])

  if (error) return <div className="bn-error">Could not load bond data. Try refreshing.</div>

  if (b && !b.available) {
    return (
      <div>
        <div className="bn-hero bn-unavail">
          <div className="bn-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="bn-badge-emoji">⚪</span> Data Unavailable
          </div>
          <p className="bn-summary">{b.subtitle} The data source is rate-limited or briefly down — refresh in a minute.</p>
        </div>
        <Styles />
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Bond Status — badge + subtitle + 2. Summary ── */}
      <div className="bn-hero">
        {loading || !b ? (
          <>
            <div className="skeleton" style={{ height: 30, width: 260, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '60%' }} />
          </>
        ) : (
          <>
            <div className="bn-eyebrow">What are bond investors signalling?</div>
            <div className="bn-badge" style={{ color: TONE_COLORS[b.status.tone] }}>
              <span className="bn-badge-emoji">{b.status.emoji}</span> {b.status.label}
            </div>
            {b.subtitle && <div className="bn-subtitle">{b.subtitle}</div>}
            <p className="bn-summary">{b.summary}</p>
          </>
        )}
      </div>

      {/* ── 3. Biggest risk / biggest stabilizer ── */}
      {b && (
        <div className="bn-callouts">
          <div className="bn-callout bn-callout-risk">
            <div className="bn-callout-label">▲ Biggest risk</div>
            <div className="bn-callout-text">{b.risk}</div>
          </div>
          <div className="bn-callout bn-callout-stab">
            <div className="bn-callout-label">▼ Biggest stabilizer</div>
            <div className="bn-callout-text">{b.stabilizer}</div>
          </div>
        </div>
      )}

      {/* ── 4. Key Drivers scorecard ── */}
      <div className="bn-section-label">Key drivers</div>
      <div className="bn-drivers">
        {(b?.categories || []).map(c => (
          <button
            key={c.key}
            className="bn-driver"
            onClick={() => setOpenCat(openCat === c.key ? null : c.key)}
            title="Click for the underlying metrics"
          >
            <div className="bn-driver-top">
              <span className="bn-driver-label">
                {c.label}<span className="bn-driver-caret">{openCat === c.key ? '▾' : '▸'}</span>
              </span>
              <span className="bn-badge-pill" style={{ color: TONE_COLORS[c.tone], background: TONE_BG[c.tone] }}>
                {TONE_DOT[c.tone]} {c.status}
              </span>
            </div>
            <div className="bn-driver-bar">
              <div className="bn-driver-fill" style={{ width: `${Math.round(c.fill * 100)}%`, background: TONE_COLORS[c.tone] }} />
            </div>
            {openCat === c.key && (
              <div className="bn-driver-detail">
                <div className="bn-metric-grid">
                  {c.metrics.map((m, i) => (
                    <div className="bn-metric" key={i}>
                      <div className="bn-metric-label">{m.label}</div>
                      <div className="bn-metric-value">{m.value}</div>
                      {m.sub && <div className="bn-metric-sub">{m.sub}</div>}
                    </div>
                  ))}
                </div>
                <ul className="bn-driver-signals">
                  {c.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </button>
        ))}
        {loading && [1, 2, 3, 4].map(i => (
          <div key={i} className="bn-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── 5. Recent bond alerts (never empty) ── */}
      <div className="bn-section-label">Recent bond alerts</div>
      {b && b.alerts.length === 0 ? (
        <div className="bn-noalert">
          <div className="bn-noalert-line">No active bond alerts.</div>
          {b.lastAlert && <div className="bn-lastalert"><span>Last alert</span>{b.lastAlert}</div>}
        </div>
      ) : (
        (b?.alerts || []).map(a => (
          <div className="bn-alert" key={a.id}>
            <div className="bn-alert-title">⚠ {a.title}</div>
            <div className="bn-alert-row"><span>What happened</span>{a.what}</div>
            <div className="bn-alert-row"><span>Why it matters</span>{a.why}</div>
            <div className="bn-alert-row"><span>Affected systems</span>
              <div className="bn-chips">{a.affected.map(x => <span className="bn-chip" key={x}>{x}</span>)}</div>
            </div>
            <div className="bn-alert-row"><span>Historical context</span>{a.context}</div>
          </div>
        ))
      )}

      {/* ── 6. Watching closely (never empty) ── */}
      <div className="bn-section-label">Watching closely</div>
      <div className="bn-watch-note">What may break next — distance to each alert threshold.</div>
      {b && b.watching.length === 0 && (
        <div className="bn-empty">All key thresholds are comfortably clear right now.</div>
      )}
      {(b?.watching || []).map(w => (
        <div className="bn-watch" key={w.label}>
          <div className="bn-watch-head">
            <span className="bn-watch-label">{w.proximity > 0.7 ? '🔥' : '⚠️'} {w.label}</span>
            <span className="bn-watch-text">{w.text}</span>
          </div>
          <div className="bn-watch-bar">
            <div
              className="bn-watch-fill"
              style={{
                width: `${Math.round(w.proximity * 100)}%`,
                background: w.proximity > 0.85 ? '#E24B4A' : w.proximity > 0.6 ? '#BA7517' : '#639922',
              }}
            />
          </div>
        </div>
      ))}

      {b && (
        <div className="bn-foot">
          Data: FRED (Treasury yields 2Y–30Y, 3M & 2Y–10Y spreads, 10Y TIPS real yield, fed funds, debt-to-GDP).
          Treasury volatility is a realized-vol proxy for the MOVE index; auction bid-to-cover has no free real-time source.
          Updated {new Date(b.fetchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
        </div>
      )}

      <Styles />
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .bn-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
      .bn-unavail { border-style: dashed; }
      .bn-eyebrow { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 8px; }
      .bn-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .bn-badge-emoji { font-size: 24px; }
      .bn-subtitle { font-size: 13.5px; color: var(--text-primary); font-weight: 500; margin-bottom: 10px; }
      .bn-summary { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin: 0; max-width: 78ch; }

      .bn-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .bn-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; }
      .bn-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .bn-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .bn-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; }
      .bn-callout-risk .bn-callout-label { color: #A32D2D; }
      .bn-callout-stab .bn-callout-label { color: #3B6D11; }
      .bn-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }

      .bn-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .bn-drivers { display: flex; flex-direction: column; gap: 6px; }
      .bn-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .bn-driver:hover { border-color: var(--border-med); }
      .bn-driver-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .bn-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .bn-driver-caret { font-size: 9px; color: var(--text-muted); }
      .bn-badge-pill { font-size: 11px; font-weight: 600; font-family: var(--mono); padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
      .bn-driver-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 9px; }
      .bn-driver-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
      .bn-driver-detail { margin-top: 12px; }
      .bn-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
      .bn-metric { background: var(--bg); border: 0.5px solid var(--border); border-radius: 6px; padding: 8px 10px; }
      .bn-metric-label { font-size: 10px; color: var(--text-muted); margin-bottom: 3px; line-height: 1.3; }
      .bn-metric-value { font-size: 16px; font-weight: 500; font-family: var(--mono); color: var(--text-primary); line-height: 1.1; }
      .bn-metric-sub { font-size: 10px; color: var(--text-muted); font-family: var(--mono); margin-top: 2px; }
      .bn-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

      .bn-noalert { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; }
      .bn-noalert-line { font-size: 12.5px; color: var(--text-secondary); }
      .bn-lastalert { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); margin-top: 6px; display: flex; gap: 8px; }
      .bn-lastalert > span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
      .bn-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 6px 2px; }
      .bn-alert { background: var(--card-bg); border: 0.5px solid #EF9F27; border-radius: 8px; padding: 13px 15px; margin-bottom: 8px; }
      .bn-alert-title { font-size: 13.5px; font-weight: 600; color: #854F0B; margin-bottom: 8px; }
      .bn-alert-row { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 5px; display: flex; gap: 10px; }
      .bn-alert-row > span:first-child { flex: 0 0 120px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); padding-top: 2px; }
      .bn-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .bn-chip { font-size: 10.5px; font-family: var(--mono); background: var(--border); border-radius: 4px; padding: 2px 7px; color: var(--text-secondary); }

      .bn-watch-note { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
      .bn-watch { margin-bottom: 11px; }
      .bn-watch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 12px; }
      .bn-watch-label { font-size: 12.5px; color: var(--text-primary); }
      .bn-watch-text { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); text-align: right; }
      .bn-watch-bar { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .bn-watch-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

      .bn-foot { font-size: 10.5px; color: var(--text-muted); font-family: var(--mono); line-height: 1.6; margin-top: 1.6rem; padding-top: 10px; border-top: 0.5px solid var(--border); }
      .bn-error { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }
      @media (max-width: 520px) { .bn-callouts { grid-template-columns: 1fr; } .bn-alert-row { flex-direction: column; gap: 2px; } .bn-alert-row > span:first-child { flex: none; } }
    `}</style>
  )
}
