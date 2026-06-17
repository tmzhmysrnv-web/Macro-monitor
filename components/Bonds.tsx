// components/Bonds.tsx
// Bond-market intelligence view — an economic early-warning radar, not a bond
// trading terminal. Answers "what are bond investors telling us?" via:
//   Status → Summary → Biggest Risk/Stabilizer → Key Drivers → Recent Alerts → Watching
import { useEffect, useState } from 'react'
import Icon, { STATUS_ICON } from './Icon'
import DriverMetricCard, { type MetricCardData } from './DriverMetricCard'

type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
type Category = { key: string; label: string; status: string; tone: Tone; fill: number; signals: string[]; metrics: MetricCardData[] }
type Alert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }
type WatchItem = { label: string; text: string; proximity: number }
type Callout = { text: string; why: string; key: string }
type FedPolicy = {
  currentRate: number | null
  lastChangeAmount: number
  lastChangeDirection: 'hike' | 'cut' | 'none'
  lastChangeDate: string | null
  daysSinceChange: number | null
  latestMeetingResult: string
  fresh: boolean
  history?: { date: string; value: number }[]
}
type FedWatchItem = { key: string; label: string; icon: string; status: 'monitoring' | 'impact' | 'stabilized'; severity: 'none' | 'amber' | 'red'; detail: string }
type FedWatch = { active: boolean; eventType: 'hike' | 'cut' | null; items: FedWatchItem[]; impactCount: number; total: number }
type RateExpectation = { method: 'futures' | 'treasury' | 'none'; expectedDirection: 'cut' | 'hike' | 'hold'; surprise: boolean; probabilities?: { cut50: number; cut25: number; hold: number; hike25: number }; impliedRate?: number; meetingDate?: string; basis: string }
type BondResponse = {
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
  fedPolicy?: FedPolicy
  fedWatch?: FedWatch
  rateExpectation?: RateExpectation
  fetchedAt: string
}

const TONE_COLORS: Record<Tone, string> = {
  good: 'var(--good)', neutral: 'var(--neutral)', warn: 'var(--warn)', bad: 'var(--bad)', crisis: 'var(--crisis)',
}
const TONE_BG: Record<Tone, string> = {
  good: 'rgba(99,153,34,0.14)', neutral: 'rgba(158,158,46,0.16)', warn: 'rgba(186,117,23,0.16)',
  bad: 'rgba(226,75,74,0.15)', crisis: 'rgba(163,45,45,0.18)',
}

// Step-line of the policy-rate path — context for the banner ("what it means").
// Filled like the site's other charts (area gradient + current-point dot) so it
// doesn't read as a flat, contextless line.
function RateSpark({ points, tone }: { points: { date: string; value: number }[]; tone: string }) {
  if (!points || points.length < 2) return null
  const W = 210, H = 44, top = 4, bot = H - 4
  const vals = points.map(p => p.value)
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const xs = points.map((_, i) => (i / (points.length - 1)) * W)
  const ys = points.map(p => bot - (p.value - min) / range * (bot - top))
  let line = `M ${xs[0].toFixed(1)} ${ys[0].toFixed(1)}`
  for (let i = 1; i < points.length; i++) line += ` L ${xs[i].toFixed(1)} ${ys[i - 1].toFixed(1)} L ${xs[i].toFixed(1)} ${ys[i].toFixed(1)}`
  const area = `${line} L ${xs[xs.length - 1].toFixed(1)} ${bot} L ${xs[0].toFixed(1)} ${bot} Z`
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      <defs>
        <linearGradient id="fpgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.2" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#fpgrad)" stroke="none" />
      <path d={line} fill="none" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1].toFixed(1)} cy={ys[ys.length - 1].toFixed(1)} r="2.8" fill="var(--text-primary)" stroke="var(--card-bg)" strokeWidth="1.5" />
    </svg>
  )
}

// When the Fed moves, surface the areas most likely to feel it (temporary).
function WatchListActivated({ fw }: { fw?: FedWatch }) {
  if (!fw || !fw.active || fw.items.length === 0) return null
  const sIcon = (it: FedWatchItem) => it.status === 'impact' ? (it.severity === 'red' ? 'alert-circle' : 'alert-triangle') : it.status === 'stabilized' ? 'circle-check' : 'circle'
  const sColor = (it: FedWatchItem) => it.status === 'impact' ? (it.severity === 'red' ? 'var(--crisis)' : 'var(--warn)') : it.status === 'stabilized' ? 'var(--good)' : 'var(--text-muted)'
  const sWord = (it: FedWatchItem) => it.status === 'impact' ? (it.severity === 'red' ? 'Impact' : 'Watch') : it.status === 'stabilized' ? 'Stable' : 'Monitoring'
  return (
    <div className="wl">
      <div className="wl-head"><Icon name="activity" size={15} style={{ verticalAlign: -2.5, marginRight: 7 }} />Watch list activated</div>
      <div className="wl-sub">Tracking the areas most likely to be affected by the rate {fw.eventType}.</div>
      <div className="wl-items">
        {fw.items.map(it => (
          <div className={`wl-item wl-${it.status} wl-sev-${it.severity}`} key={it.key}>
            <span className="wl-ic" style={{ color: sColor(it) }}><Icon name={it.icon as never} size={15} /></span>
            <div className="wl-main">
              <div className="wl-label">{it.label}</div>
              <div className="wl-detail">{it.detail}</div>
            </div>
            <span className="wl-status" style={{ color: sColor(it) }}>
              <Icon name={sIcon(it) as never} size={13} style={{ verticalAlign: -2, marginRight: 4 }} />{sWord(it)}
            </span>
          </div>
        ))}
      </div>
      <div className="wl-foot">{fw.impactCount} of {fw.total} indicators showing impact</div>
    </div>
  )
}

// Market-implied odds for the next FOMC decision (from fed-funds futures).
// Only shown for the futures method; hidden when it falls back to the 2Y proxy.
function FedOdds({ re }: { re?: RateExpectation }) {
  if (!re || re.method !== 'futures' || !re.probabilities) return null
  const p = re.probabilities
  const cut = Math.round((p.cut50 + p.cut25) * 10) / 10
  const hold = p.hold
  const hike = p.hike25
  const when = re.meetingDate ? new Date(re.meetingDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  const dom = hold >= cut && hold >= hike ? 'hold' : cut >= hike ? 'cut' : 'hike'
  const cells: { key: string; label: string; sub: string; val: number; tone: string; bg: string }[] = [
    { key: 'cut', label: 'Cut', sub: '−25 bp', val: cut, tone: 'var(--good)', bg: 'var(--good-bg)' },
    { key: 'hold', label: 'Hold', sub: 'no change', val: hold, tone: 'var(--good)', bg: 'var(--good-bg)' },
    { key: 'hike', label: 'Hike', sub: '+25 bp', val: hike, tone: 'var(--bad)', bg: 'var(--alert-bg)' },
  ]
  return (
    <div className="fo">
      <div className="fo-head">
        <span className="fo-title">Rate decision odds</span>
        <span className="fo-meta">market-implied · FOMC {when}</span>
      </div>
      <div className="fo-cells">
        {cells.map(c => {
          const isDom = dom === c.key
          return (
            <div className="fo-cell" key={c.key} style={isDom ? { border: `1px solid ${c.tone}`, background: c.bg } : undefined}>
              <div className="fo-cell-k" style={isDom ? { color: c.tone } : undefined}>{c.label} · {c.sub}</div>
              <div className="fo-cell-v" style={{ color: isDom ? c.tone : 'var(--text-secondary)' }}>{c.val}%</div>
            </div>
          )
        })}
      </div>
      <div className="fo-bar">
        <div style={{ width: `${cut}%`, background: 'var(--good)' }} />
        <div style={{ width: `${hold}%`, background: '#5b6470' }} />
        <div style={{ width: `${hike}%`, background: 'var(--bad)' }} />
      </div>
      {re.impliedRate != null && (
        <div className="fo-foot">Implied <strong>{re.impliedRate.toFixed(2)}%</strong> post-meeting · from 30-day fed-funds futures</div>
      )}
    </div>
  )
}

export default function Bonds({ initialData = null }: { initialData?: BondResponse | null }) {
  const [b, setB] = useState<BondResponse | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState(false)
  const [openCat, setOpenCat] = useState<string | null>(null)

  // Fetch only if the parent didn't already prefetch this section.
  useEffect(() => {
    if (b) return
    fetch('/api/bonds')
      .then(r => r.json())
      .then(d => { if (d.error) setError(true); else setB(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [b])

  // Pick up prefetched data if it arrives after mount.
  useEffect(() => {
    if (initialData && !b) { setB(initialData); setLoading(false) }
  }, [initialData, b])

  // Click a risk/stabilizer callout → open + scroll to its Key Driver.
  function goToDriver(key: string) {
    if (!key) return
    setOpenCat(key)
    setTimeout(() => document.getElementById(`bn-drv-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  if (error) return <div className="bn-error">Could not load bond data. Try refreshing.</div>

  if (b && !b.available) {
    return (
      <div>
        <div className="bn-hero bn-unavail">
          <div className="bn-badge" style={{ color: 'var(--text-muted)' }}>
            <span className="bn-badge-emoji"><Icon name="circle" size={20} /></span> Data Unavailable
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
              <span className="bn-badge-emoji"><Icon name="chart-line" size={22} /></span> {b.status.label}
            </div>
            {b.subtitle && <div className="bn-subtitle">{b.subtitle}</div>}
            <p className="bn-summary">{b.summary}</p>
          </>
        )}
      </div>

      {/* ── 2b. Fed Policy banner — rate decisions as events, not a KPI card ── */}
      {b && b.fedPolicy && b.fedPolicy.currentRate != null && (() => {
        const fp = b.fedPolicy
        const alert = fp.fresh && fp.lastChangeDirection !== 'none'
        const hike = fp.lastChangeDirection === 'hike'
        const state = alert ? (hike ? 'hike' : 'cut') : 'neutral'
        const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`
        const ago = fp.daysSinceChange
        const agoText = ago == null ? '—' : ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`
        const hist = fp.history && fp.history.length > 1 ? fp.history : null
        const sparkTone = state === 'hike' ? 'var(--crisis)' : state === 'cut' ? 'var(--good)' : 'var(--text-secondary)'
        const spark = hist ? (() => {
          const v = hist.map(p => p.value)
          const lo = Math.min(...v), hi = Math.max(...v)
          const cur = fp.currentRate ?? v[v.length - 1]
          const pctl = hi > lo ? Math.round((cur - lo) / (hi - lo) * 100) : 50
          const histLabel = pctl <= 20 ? 'historically low' : pctl < 40 ? 'below normal' : pctl <= 60 ? 'mid-range' : pctl < 80 ? 'above normal' : 'historically high'
          return (
            <div className="fp-spark">
              <RateSpark points={hist} tone={sparkTone} />
              <div className="fp-pctl">
                <div className="fp-pctl-top"><span>{histLabel}</span><span>{lo.toFixed(2)}–{hi.toFixed(2)}%</span></div>
                <div className="fp-pctl-track">
                  <div className="fp-pctl-fill" style={{ width: `${pctl}%` }} />
                  <div className="fp-pctl-dot" style={{ left: `${pctl}%` }} />
                </div>
              </div>
              <div className="fp-spark-cap">10-year path</div>
            </div>
          )
        })() : null
        return (
          <div className={`fp-banner fp-${state}`}>
            {alert ? (
              <>
                <div className="fp-left">
                  <span className="fp-head">
                    <span className="fp-dot" />
                    <Icon name={hike ? 'alert-circle' : 'circle-check'} size={15} style={{ verticalAlign: -2.5, marginRight: 6 }} />
                    Rate {hike ? 'hike' : 'cut'} detected
                  </span>
                  <span className="fp-big">{signed(fp.lastChangeAmount)}</span>
                </div>
                {spark}
                <div className="fp-right">
                  <div className="fp-now">Federal funds rate now <strong>{fp.currentRate!.toFixed(2)}%</strong></div>
                  <div className="fp-when">{agoText}</div>
                </div>
              </>
            ) : (
              <>
                <div className="fp-left">
                  <span className="fp-head fp-head-neutral">
                    <Icon name="bank" size={15} style={{ verticalAlign: -2.5, marginRight: 6 }} />
                    Fed policy
                  </span>
                  <span className="fp-rate">Current rate <strong>{fp.currentRate!.toFixed(2)}%</strong></span>
                </div>
                {spark}
                <div className="fp-meta">
                  <div className="fp-meta-item">
                    <span className="fp-k">Last change</span>
                    <span className="fp-v">{fp.lastChangeDirection === 'none' ? '—' : `${signed(fp.lastChangeAmount)} · ${agoText}`}</span>
                  </div>
                  <div className="fp-meta-item">
                    <span className="fp-k">Latest meeting</span>
                    <span className="fp-v">{fp.latestMeetingResult}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* ── 2b2. Market-implied odds for the next decision ── */}
      {b && <FedOdds re={b.rateExpectation} />}

      {/* ── 2c. Watch List Activated — consequences of the Fed move ── */}
      {b && <WatchListActivated fw={b.fedWatch} />}

      {/* ── 3. Biggest risk / biggest stabilizer (click → its driver) ── */}
      {b && (
        <div className="bn-callouts">
          <div className="bn-callout bn-callout-risk" role="button" tabIndex={0}
            onClick={() => goToDriver(b.risk.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(b.risk.key) }}>
            <div className="bn-callout-label">▲ Biggest risk {b.risk.key && <span className="bn-callout-go">see driver →</span>}</div>
            <div className="bn-callout-text">{b.risk.text}</div>
            {b.risk.why && <div className="bn-callout-why">{b.risk.why}</div>}
          </div>
          <div className="bn-callout bn-callout-stab" role="button" tabIndex={0}
            onClick={() => goToDriver(b.stabilizer.key)}
            onKeyDown={e => { if (e.key === 'Enter') goToDriver(b.stabilizer.key) }}>
            <div className="bn-callout-label">▼ Biggest stabilizer {b.stabilizer.key && <span className="bn-callout-go">see driver →</span>}</div>
            <div className="bn-callout-text">{b.stabilizer.text}</div>
            {b.stabilizer.why && <div className="bn-callout-why">{b.stabilizer.why}</div>}
          </div>
        </div>
      )}

      {/* ── 4. Key Drivers scorecard ── */}
      <div className="bn-section-label">Key drivers</div>
      <div className="bn-drivers">
        {(b?.categories || []).map(c => (
          <div
            key={c.key}
            id={`bn-drv-${c.key}`}
            className="bn-driver"
            role="button"
            tabIndex={0}
            onClick={() => setOpenCat(openCat === c.key ? null : c.key)}
            onKeyDown={e => { if (e.key === 'Enter') setOpenCat(openCat === c.key ? null : c.key) }}
            title="Click for the underlying metrics"
          >
            <div className="bn-driver-top">
              <span className="bn-driver-label">
                {c.label}<span className="bn-driver-caret">{openCat === c.key ? '▾' : '▸'}</span>
              </span>
              <span className="bn-badge-pill" style={{ color: TONE_COLORS[c.tone], background: TONE_BG[c.tone] }}>
                <Icon name={STATUS_ICON[c.tone]} size={13} style={{ flexShrink: 0 }} />{c.status}
              </span>
            </div>
            <div className="bn-driver-bar">
              <div className="bn-driver-fill" style={{ width: `${Math.round(c.fill * 100)}%`, background: TONE_COLORS[c.tone] }} />
            </div>
            {openCat === c.key && (
              <div className="bn-driver-detail">
                <div className="bn-metric-grid" onClick={e => e.stopPropagation()}>
                  {c.metrics.map((m, i) => <DriverMetricCard key={i} m={m} />)}
                </div>
                <ul className="bn-driver-signals">
                  {c.signals.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </div>
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
            <span className="bn-watch-label"><Icon name={w.proximity > 0.7 ? 'flame' : 'alert-triangle'} size={13} style={{ display: 'inline-block', verticalAlign: -2, marginRight: 4, color: w.proximity > 0.7 ? 'var(--bad)' : 'var(--warn)' }} />{w.label}</span>
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

      /* Fed Policy banner — event, not statistic. Higher prominence than cards. */
      .fp-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; min-height: 76px; border-radius: 10px; padding: 14px 20px; margin-bottom: 14px; border: 0.5px solid var(--border); background: var(--card-bg); }
      .fp-hike { border: 1px solid var(--crisis); border-left: 4px solid var(--crisis); background: var(--alert-bg); }
      .fp-cut { border: 1px solid var(--good); border-left: 4px solid var(--good); background: var(--good-bg); }
      .fp-left { display: flex; flex-direction: column; gap: 6px; }
      .fp-head { font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; font-family: var(--mono); display: inline-flex; align-items: center; }
      .fp-hike .fp-head { color: var(--crisis); }
      .fp-cut .fp-head { color: var(--good); }
      .fp-head-neutral { color: var(--text-muted); }
      .fp-big { font-size: 30px; font-weight: 600; font-family: var(--mono); line-height: 1; }
      .fp-hike .fp-big { color: var(--crisis); }
      .fp-cut .fp-big { color: var(--good); }
      .fp-rate { font-size: 15px; color: var(--text-secondary); }
      .fp-rate strong, .fp-now strong { color: var(--text-primary); font-weight: 600; font-family: var(--mono); }
      .fp-right { text-align: right; }
      .fp-now { font-size: 14px; color: var(--text-primary); }
      .fp-when { font-size: 11px; color: var(--text-muted); font-family: var(--mono); margin-top: 4px; }
      .fp-meta { display: flex; gap: 28px; }
      .fp-meta-item { display: flex; flex-direction: column; gap: 3px; }
      .fp-k { font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); }
      .fp-v { font-size: 13px; color: var(--text-primary); font-family: var(--mono); }
      .fp-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 9px; flex-shrink: 0; animation: fppulse 1.5s ease-in-out infinite; }
      .fp-hike .fp-dot { background: var(--crisis); }
      .fp-cut .fp-dot { background: var(--good); }
      @keyframes fppulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
      .fp-spark { display: flex; flex-direction: column; align-items: stretch; gap: 5px; flex: 0 1 auto; min-width: 200px; }
      .fp-spark-cap { font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); text-align: center; }
      .fp-pctl-top { display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); font-family: var(--mono); margin-bottom: 3px; }
      .fp-pctl-track { position: relative; height: 3px; background: var(--border-med); border-radius: 2px; }
      .fp-pctl-fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--text-secondary); opacity: 0.45; border-radius: 2px; }
      .fp-pctl-dot { position: absolute; top: -2px; width: 7px; height: 7px; border-radius: 50%; background: var(--text-secondary); border: 1.5px solid var(--card-bg); transform: translateX(-50%); }
      @media (max-width: 520px) { .fp-banner { flex-direction: column; align-items: flex-start; gap: 12px; } .fp-right, .fp-meta { text-align: left; } .fp-spark { align-items: flex-start; } }

      /* Market-implied rate-decision odds */
      .fo { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
      .fo-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 12px; }
      .fo-title { font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-primary); }
      .fo-meta { font-family: var(--mono); font-size: 11px; color: var(--text-secondary); }
      .fo-cells { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px; }
      .fo-cell { border: 0.5px solid var(--border); border-radius: 8px; padding: 10px 12px; text-align: center; }
      .fo-cell-k { font-family: var(--mono); font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; }
      .fo-cell-v { font-family: var(--mono); font-size: 22px; font-weight: 600; line-height: 1; }
      .fo-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,0.06); margin-bottom: 10px; }
      .fo-foot { font-size: 11.5px; color: var(--text-secondary); padding-top: 10px; border-top: 0.5px solid var(--border); }
      .fo-foot strong { color: var(--text-primary); font-family: var(--mono); font-weight: 600; }

      /* Watch List Activated — temporary consequence tracker after a Fed move */
      .wl { border: 0.5px solid var(--border); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; background: var(--card-bg); }
      .wl-head { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; font-family: var(--mono); color: var(--text-primary); display: inline-flex; align-items: center; }
      .wl-sub { font-size: 12px; color: var(--text-muted); margin: 4px 0 12px; }
      .wl-items { display: flex; flex-direction: column; gap: 6px; }
      .wl-item { display: flex; align-items: center; gap: 11px; padding: 9px 11px; border-radius: 8px; border: 0.5px solid var(--border); border-left: 3px solid var(--border-med); background: var(--bg); }
      .wl-sev-amber { border-left-color: var(--warn); background: var(--warn-bg); }
      .wl-sev-red { border-left-color: var(--crisis); background: var(--alert-bg); }
      .wl-stabilized { opacity: 0.7; }
      .wl-ic { flex-shrink: 0; display: flex; }
      .wl-main { flex: 1; min-width: 0; }
      .wl-label { font-size: 13px; color: var(--text-primary); font-weight: 500; }
      .wl-detail { font-size: 11.5px; color: var(--text-secondary); margin-top: 1px; }
      .wl-status { font-size: 11px; font-weight: 600; font-family: var(--mono); white-space: nowrap; display: inline-flex; align-items: center; }
      .wl-foot { font-size: 11px; font-family: var(--mono); color: var(--text-muted); margin-top: 11px; padding-top: 9px; border-top: 0.5px solid var(--border); }

      .bn-callouts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
      .bn-callout { border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 13px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
      .bn-callout-risk { background: rgba(226,75,74,0.06); border-color: rgba(226,75,74,0.3); }
      .bn-callout-stab { background: rgba(99,153,34,0.06); border-color: rgba(99,153,34,0.3); }
      .bn-callout-risk:hover { background: rgba(226,75,74,0.1); }
      .bn-callout-stab:hover { background: rgba(99,153,34,0.1); }
      .bn-callout-label { font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; font-family: var(--mono); margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .bn-callout-risk .bn-callout-label { color: #A32D2D; }
      .bn-callout-stab .bn-callout-label { color: #3B6D11; }
      .bn-callout-go { font-size: 9px; font-weight: 500; opacity: 0; letter-spacing: 0.02em; transition: opacity 0.15s; }
      .bn-callout:hover .bn-callout-go { opacity: 0.85; }
      .bn-callout-text { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
      .bn-callout-why { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--border); }

      .bn-section-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 1.4rem 0 8px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); font-family: var(--mono); }

      .bn-drivers { display: flex; flex-direction: column; gap: 6px; }
      .bn-driver { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 11px 14px; text-align: left; cursor: pointer; font: inherit; color: inherit; width: 100%; transition: border-color 0.15s; }
      .bn-driver:hover { border-color: var(--border-med); }
      .bn-driver-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
      .bn-driver-label { font-size: 13px; color: var(--text-primary); display: inline-flex; align-items: center; gap: 7px; }
      .bn-driver-caret { font-size: 9px; color: var(--text-muted); }
      .bn-badge-pill { font-size: 12px; font-weight: 600; font-family: var(--mono); padding: 3px 11px; border-radius: 20px; white-space: nowrap; letter-spacing: 0.02em; display: inline-flex; align-items: center; gap: 5px; line-height: 1; }
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
