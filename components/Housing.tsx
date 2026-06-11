// components/Housing.tsx
// The Housing tab: one headline status + story, not a wall of charts.
// Top: status badge, summary, five category drivers.
// Middle: active housing alerts. Bottom: "watching closely" proximity list.
import { useEffect, useState } from 'react'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type MetricCard = { label: string; value: string; sub?: string }
type Category = { key: string; label: string; status: string; tone: Tone; signals: string[]; metrics: MetricCard[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type HousingResponse = {
  status: { emoji: string; label: string; tone: Tone }
  summary: string
  categories: Category[]
  alerts: Alert[]
  watching: WatchItem[]
  fetchedAt: string
}

const TONE_COLORS: Record<Tone, string> = {
  good: '#639922',
  neutral: 'var(--text-muted)',
  warn: '#BA7517',
  bad: '#E24B4A',
  crisis: '#A32D2D',
}
const TONE_DOT: Record<Tone, string> = {
  good: '🟢', neutral: '⚪', warn: '🟠', bad: '🔴', crisis: '🚨',
}

export default function Housing() {
  const [h, setH] = useState<HousingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/housing')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setH(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [])

  if (error) return <div className="hs-error">Could not load housing data. Try refreshing.</div>

  return (
    <div>
      {/* ── Status badge + summary ── */}
      <div className="hs-hero">
        {loading || !h ? (
          <>
            <div className="skeleton" style={{ height: 34, width: 260, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 13, width: '95%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '88%', marginBottom: 6 }} />
            <div className="skeleton" style={{ height: 13, width: '70%' }} />
          </>
        ) : (
          <>
            <div className="hs-badge" style={{ color: TONE_COLORS[h.status.tone] }}>
              <span className="hs-badge-emoji">{h.status.emoji}</span> {h.status.label}
            </div>
            <p className="hs-summary">{h.summary}</p>
          </>
        )}
      </div>

      {/* ── Key drivers ── */}
      <div className="hs-section-label">Key drivers</div>
      <div className="hs-drivers">
        {(h?.categories || []).map(c => (
          <button
            key={c.key}
            className="hs-driver"
            onClick={() => setOpenCat(openCat === c.key ? null : c.key)}
            title="Click for the underlying metrics"
          >
            <div className="hs-driver-top">
              <span className="hs-driver-label">
                {c.label}
                <span className="hs-driver-caret">{openCat === c.key ? '▾' : '▸'}</span>
              </span>
              <span className="hs-driver-status" style={{ color: TONE_COLORS[c.tone] }}>
                {TONE_DOT[c.tone]} {c.status}
              </span>
            </div>
            {openCat === c.key && (
              <div className="hs-driver-detail">
                <div className="hs-metric-grid">
                  {c.metrics.map((m, i) => (
                    <div className="hs-metric" key={i}>
                      <div className="hs-metric-label">{m.label}</div>
                      <div className="hs-metric-value">{m.value}</div>
                      {m.sub && <div className="hs-metric-sub">{m.sub}</div>}
                    </div>
                  ))}
                </div>
                <ul className="hs-driver-signals">
                  {c.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </button>
        ))}
        {loading && [1, 2, 3, 4, 5].map(i => (
          <div key={i} className="hs-driver"><div className="skeleton" style={{ height: 16, width: '80%' }} /></div>
        ))}
      </div>

      {/* ── Alerts ── */}
      <div className="hs-section-label">Recent housing alerts</div>
      {h && h.alerts.length === 0 && (
        <div className="hs-empty">No housing alerts — nothing has crossed a threshold.</div>
      )}
      {(h?.alerts || []).map(a => (
        <div className="hs-alert" key={a.id}>
          <div className="hs-alert-title">⚠ {a.title}</div>
          <div className="hs-alert-row"><span>What happened</span>{a.what}</div>
          <div className="hs-alert-row"><span>Why it matters</span>{a.why}</div>
          <div className="hs-alert-row"><span>Affected areas</span>
            <div className="hs-chips">{a.affected.map(x => <span className="hs-chip" key={x}>{x}</span>)}</div>
          </div>
          <div className="hs-alert-row"><span>Historical context</span>{a.context}</div>
        </div>
      ))}

      {/* ── Watching closely ── */}
      <div className="hs-section-label">Watching closely</div>
      <div className="hs-watch-note">What may break next — distance to each alert threshold.</div>
      {(h?.watching || []).map(w => (
        <div className="hs-watch" key={w.label}>
          <div className="hs-watch-head">
            <span className="hs-watch-label">{w.label}</span>
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

      <style>{`
        .hs-hero { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 18px 20px; margin-bottom: 1.5rem; }
        .hs-badge { font-size: 22px; font-weight: 600; font-family: var(--sans); display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .hs-badge-emoji { font-size: 24px; }
        .hs-summary { font-size: 13.5px; line-height: 1.7; color: var(--text-secondary); margin: 0; }

        .hs-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

        .hs-drivers { display: flex; flex-direction: column; gap: 6px; }
        .hs-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
        .hs-driver:hover { border-color: var(--border-med); }
        .hs-driver-top { display: flex; justify-content: space-between; align-items: center; }
        .hs-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
        .hs-driver-caret { font-size: 9px; color: var(--text-muted); }
        .hs-driver-status { font-size: 12px; font-weight: 500; font-family: var(--mono); }
        .hs-driver-detail { margin-top: 12px; }
        .hs-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; }
        .hs-metric { background: var(--bg); border: 0.5px solid var(--border); border-radius: 6px; padding: 8px 10px; }
        .hs-metric-label { font-size: 10px; color: var(--text-muted); margin-bottom: 3px; line-height: 1.3; }
        .hs-metric-value { font-size: 16px; font-weight: 500; font-family: var(--mono); color: var(--text-primary); line-height: 1.1; }
        .hs-metric-sub { font-size: 10px; color: var(--text-muted); font-family: var(--mono); margin-top: 2px; }
        .hs-driver-signals { margin: 12px 0 2px; padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

        .hs-empty { font-size: 12.5px; color: var(--text-muted); font-family: var(--mono); padding: 10px 2px; }
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
        @media (max-width: 520px) { .hs-alert-row { flex-direction: column; gap: 2px; } .hs-alert-row > span:first-child { flex: none; } }
      `}</style>
    </div>
  )
}
