// components/Housing.tsx
// Housing intelligence view, built around three questions:
//   1. Is housing healthy?   → status badge + one-line subtitle
//   2. Why?                  → short summary + biggest risk / stabilizer + key drivers
//   3. What to watch next?   → recent alerts + watching-closely thresholds
import { useEffect, useState } from 'react'
import DriverMetricCard, { type MetricCardData } from './DriverMetricCard'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCardData[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type HousingResponse = {
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
  good: '#639922', neutral: 'var(--text-muted)', warn: '#BA7517', bad: '#E24B4A', crisis: '#A32D2D',
}
const TONE_BG: Record<Tone, string> = {
  good: 'rgba(99,153,34,0.14)', neutral: 'rgba(150,150,150,0.14)', warn: 'rgba(186,117,23,0.16)',
  bad: 'rgba(226,75,74,0.15)', crisis: 'rgba(163,45,45,0.18)',
}
const TONE_DOT: Record<Tone, string> = { good: '🟢', neutral: '⚪', warn: '🟠', bad: '🔴', crisis: '🚨' }

export default function Housing({ initialData = null }: { initialData?: HousingResponse | null }) {
  const [h, setH] = useState<HousingResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  // Fetch only if the parent didn't already prefetch this section.
  useEffect(() => {
    if (h) return
    fetch('/api/housing')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setH(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [h])

  // Pick up prefetched data if it arrives after mount.
  useEffect(() => {
    if (initialData && !h) { setH(initialData); setLoading(false) }
  }, [initialData, h])

  if (error) return <div className="hs-error">Could not load housing data. Try refreshing.</div>

  // Data-unavailable guard — don't fabricate a reassuring status
  if (h && !h.available) {
    return (
      <div>
        <div className="hs-hero hs-unavail">
          <div className="hs-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="hs-badge-emoji">⚪</span> Data Unavailable
          </div>
          <p className="hs-summary">{h.subtitle} The data source is rate-limited or briefly down — refresh in a minute.</p>
        </div>
        <Styles />
      </div>
    )
  }

  return (
    <div>
      {/* ── 1. Is housing healthy? — status badge + subtitle + short summary ── */}
      <div className="hs-hero">
        {loading || !h ? (
          <>
            <div className="skeleton" style={{ height: 30, width: 240, marginBottom: 10 }} />
            <div className="skeleton" style={{ height: 13, width: '70%', marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '92%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '60%' }} />
          </>
        ) : (
          <>
            <div className="hs-badge" style={{ color: TONE_COLORS[h.status.tone] }}>
              <span className="hs-badge-emoji">{h.status.emoji}</span> {h.status.label}
            </div>
            {h.subtitle && <div className="hs-subtitle">{h.subtitle}</div>}
            <p className="hs-summary">{h.summary}</p>
          </>
        )}
      </div>

      {/* ── Why? — biggest risk / biggest stabilizer ── */}
      {h && (
        <div className="hs-callouts">
          <div className="hs-callout hs-callout-risk">
            <div className="hs-callout-label">▲ Biggest risk</div>
            <div className="hs-callout-text">{h.risk}</div>
          </div>
          <div className="hs-callout hs-callout-stab">
            <div className="hs-callout-label">▼ Biggest stabilizer</div>
            <div className="hs-callout-text">{h.stabilizer}</div>
          </div>
        </div>
      )}

      {/* ── Why? — key drivers (visual, scannable) ── */}
      <div className="hs-section-label">Key drivers</div>
      <div className="hs-drivers">
        {(h?.categories || []).map(c => (
          <div
            key={c.key}
            className="hs-driver"
            role="button"
            tabIndex={0}
            onClick={() => setOpenCat(openCat === c.key ? null : c.key)}
            onKeyDown={e => { if (e.key === 'Enter') setOpenCat(openCat === c.key ? null : c.key) }}
            title="Click for the underlying metrics"
          >
            <div className="hs-driver-top">
              <span className="hs-driver-label">
                {c.label}<span className="hs-driver-caret">{openCat === c.key ? '▾' : '▸'}</span>
              </span>
              <span
                className="hs-badge-pill"
                style={{ color: TONE_COLORS[c.tone], background: TONE_BG[c.tone] }}
              >
                {TONE_DOT[c.tone]} {c.status}
              </span>
            </div>
            <div className="hs-driver-bar">
              <div className="hs-driver-fill" style={{ width: `${Math.round(c.fill * 100)}%`, background: TONE_COLORS[c.tone] }} />
            </div>
            {openCat === c.key && (
              <div className="hs-driver-detail">
                <div className="hs-metric-grid" onClick={e => e.stopPropagation()}>
                  {c.metrics.map((m, i) => <DriverMetricCard key={i} m={m} />)}
                </div>
                <ul className="hs-driver-signals">
                  {c.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && [1, 2, 3, 4, 5].map(i => (
          <div key={i} className="hs-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── What to watch next? — recent alerts (never empty) ── */}
      <div className="hs-section-label">Recent housing alerts</div>
      {h && h.alerts.length === 0 ? (
        <div className="hs-noalert">
          <div className="hs-noalert-line">No active housing alerts.</div>
          {h.lastAlert && <div className="hs-lastalert"><span>Last alert</span>{h.lastAlert}</div>}
        </div>
      ) : (
        (h?.alerts || []).map(a => (
          <div className="hs-alert" key={a.id}>
            <div className="hs-alert-title">⚠ {a.title}</div>
            <div className="hs-alert-row"><span>What happened</span>{a.what}</div>
            <div className="hs-alert-row"><span>Why it matters</span>{a.why}</div>
            <div className="hs-alert-row"><span>Affected areas</span>
              <div className="hs-chips">{a.affected.map(x => <span className="hs-chip" key={x}>{x}</span>)}</div>
            </div>
            <div className="hs-alert-row"><span>Historical context</span>{a.context}</div>
          </div>
        ))
      )}

      {/* ── What to watch next? — watching closely (never empty) ── */}
      <div className="hs-section-label">Watching closely</div>
      <div className="hs-watch-note">What may break next — distance to each alert threshold.</div>
      {h && h.watching.length === 0 && (
        <div className="hs-empty">All key thresholds are comfortably clear right now.</div>
      )}
      {(h?.watching || []).map(w => (
        <div className="hs-watch" key={w.label}>
          <div className="hs-watch-head">
            <span className="hs-watch-label">{w.proximity > 0.7 ? '🔥' : '⚠️'} {w.label}</span>
            <span className="hs-watch-text">{w.text}</span>
          </div>
          <div className="hs-watch-bar">
            <div
              className="hs-watch-fill"
              style={{
                width: `${Math.round(w.proximity * 100)}%`,
                background: w.proximity > 0.85 ? '#E24B4A' : w.proximity > 0.6 ? '#BA7517' : '#639922',
              }}
            />
          </div>
        </div>
      ))}

      {h && (
        <div className="hs-foot">
          Data: FRED (mortgage rates, listings, sales, starts, delinquencies). Some spec metrics use proxies —
          new home sales for application demand, price-cut share for market heat. Updated {new Date(h.fetchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
        </div>
      )}

      <Styles />
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .hs-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 14px; }
      .hs-unavail { border-style: dashed; }
      .hs-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
      .hs-badge-emoji { font-size: 24px; }
      .hs-subtitle { font-size: 13.5px; color: var(--text-primary); font-weight: 500; margin-bottom: 10px; }
      .hs-summary { font-size: 13px; line-height: 1.65; color: var(--text-secondary); margin: 0; }

      .hs-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .hs-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; }
      .hs-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .hs-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .hs-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; }
      .hs-callout-risk .hs-callout-label { color: #A32D2D; }
      .hs-callout-stab .hs-callout-label { color: #3B6D11; }
      .hs-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }

      .hs-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .hs-drivers { display: flex; flex-direction: column; gap: 6px; }
      .hs-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .hs-driver:hover { border-color: var(--border-med); }
      .hs-driver-top { display: flex; justify-content: space-between; align-items: center; }
      .hs-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .hs-driver-caret { font-size: 9px; color: var(--text-muted); }
      .hs-badge-pill { font-size: 11px; font-weight: 600; font-family: var(--mono); padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
      .hs-driver-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 9px; }
      .hs-driver-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
      .hs-driver-detail { margin-top: 12px; }
      .hs-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
      .hs-metric { background: var(--bg); border: 0.5px solid var(--border); border-radius: 6px; padding: 8px 10px; }
      .hs-metric-label { font-size: 10px; color: var(--text-muted); margin-bottom: 3px; line-height: 1.3; }
      .hs-metric-value { font-size: 16px; font-weight: 500; font-family: var(--mono); color: var(--text-primary); line-height: 1.1; }
      .hs-metric-sub { font-size: 10px; color: var(--text-muted); font-family: var(--mono); margin-top: 2px; }
      .hs-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

      .hs-noalert { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; }
      .hs-noalert-line { font-size: 12.5px; color: var(--text-secondary); }
      .hs-lastalert { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); margin-top: 6px; display: flex; gap: 8px; }
      .hs-lastalert > span { font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; }
      .hs-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 6px 2px; }
      .hs-alert { background: var(--card-bg); border: 0.5px solid #EF9F27; border-radius: 8px; padding: 13px 15px; margin-bottom: 8px; }
      .hs-alert-title { font-size: 13.5px; font-weight: 600; color: #854F0B; margin-bottom: 8px; }
      .hs-alert-row { font-size: 12.5px; line-height: 1.6; color: var(--text-secondary); margin-bottom: 5px; display: flex; gap: 10px; }
      .hs-alert-row > span:first-child { flex: 0 0 110px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); padding-top: 2px; }
      .hs-chips { display: flex; flex-wrap: wrap; gap: 5px; }
      .hs-chip { font-size: 10.5px; font-family: var(--mono); background: var(--border); border-radius: 4px; padding: 2px 7px; color: var(--text-secondary); }

      .hs-watch-note { font-size: 11.5px; color: var(--text-muted); margin-bottom: 10px; }
      .hs-watch { margin-bottom: 11px; }
      .hs-watch-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; gap: 12px; }
      .hs-watch-label { font-size: 12.5px; color: var(--text-primary); }
      .hs-watch-text { font-size: 11.5px; color: var(--text-muted); font-family: var(--mono); text-align: right; }
      .hs-watch-bar { height: 5px; background: var(--border); border-radius: 3px; overflow: hidden; }
      .hs-watch-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

      .hs-foot { font-size: 10.5px; color: var(--text-muted); font-family: var(--mono); line-height: 1.6; margin-top: 1.6rem; padding-top: 10px; border-top: 0.5px solid var(--border); }
      .hs-error { font-size: 13px; color: var(--text-muted); text-align: center; padding: 2rem 0; font-family: var(--mono); }
      @media (max-width: 520px) { .hs-callouts { grid-template-columns: 1fr; } .hs-alert-row { flex-direction: column; gap: 2px; } .hs-alert-row > span:first-child { flex: none; } }
    `}</style>
  )
}
