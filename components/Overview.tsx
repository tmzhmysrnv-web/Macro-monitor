// components/Overview.tsx
// The Overview tab: Break Meter gauge + 20yr trend, What Changed This Week, Drivers of Stress
import { useEffect, useState } from 'react'

type Driver = { key: string; label: string; weight: number; contribution: number; fillPct: number; shareOfTotal: number; status: string }
type ChangeRow = { key: string; label: string; why: string; current: number; weekAgo: number; unit: string; direction: string; significance: number }
type BreakMeter = {
  total: number; level: string; verdict: string
  drivers: Driver[]
  history: { date: string; value: number }[]
  whatChanged: ChangeRow[]
}

const LEVEL_COLORS: Record<string, string> = {
  calm: '#639922', guarded: '#8FA31E', elevated: '#BA7517', high: '#D9622B', severe: '#E24B4A',
}
const CAT_COLORS: Record<string, string> = {
  calm: '#639922', elevated: '#BA7517', stressed: '#D9622B', breaking: '#E24B4A',
}

function fmt(key: string, v: number): string {
  if (key === 'sp500') return v.toLocaleString('en-US')
  if (key === 'gold') return `$${v.toLocaleString('en-US')}`
  if (key === 'oil') return `$${v.toFixed(2)}`
  if (key === 'copper') return `$${v.toFixed(3)}`
  if (key === 'joblessClaims') return `${v.toFixed(0)}k`
  if (key === 'dxy') return v.toFixed(2)
  if (key === 'yieldCurve') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  if (['treasury10y','fedfunds','cpi','hySpread','igSpread','mortgage30','vix'].includes(key)) {
    return key === 'vix' ? v.toFixed(1) : `${v.toFixed(2)}%`
  }
  return v.toFixed(1)
}

// Notable historical markers to annotate on the trend
const MARKERS = [
  { date: '2008-09', label: '2008 crisis' },
  { date: '2020-03', label: 'COVID' },
  { date: '2022-06', label: 'rate hikes' },
]

function BreakMeterTrend({ history, color }: { history: { date: string; value: number }[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!history || history.length < 2) {
    return <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', padding: '2rem 0', textAlign: 'center' }}>Building history…</div>
  }
  const W = 640, H = 160, PAD = { t: 12, r: 12, b: 24, l: 28 }
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const vals = history.map(h => h.value)
  const min = 0, max = Math.max(100, ...vals)
  const toX = (i: number) => PAD.l + (i / (history.length - 1)) * iw
  const toY = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih
  const line = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.value).toFixed(1)}`).join(' ')
  const area = `${line} ${toX(history.length - 1).toFixed(1)},${(PAD.t + ih).toFixed(1)} ${PAD.l},${(PAD.t + ih).toFixed(1)}`

  const markerIdx = MARKERS.map(m => ({
    ...m, idx: history.findIndex(h => h.date.slice(0, 7) === m.date),
  })).filter(m => m.idx >= 0)

  const hv = hover != null ? history[hover] : null

  function move(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = (e.clientX - r.left) * (W / r.width)
    const idx = Math.round(((mx - PAD.l) / iw) * (history.length - 1))
    setHover(Math.max(0, Math.min(history.length - 1, idx)))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
        <span style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>20-year trend</span>
        {hv && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>
            <span style={{ color, fontWeight: 500 }}>{hv.value}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{hv.date.slice(0, 7)}</span>
          </span>
        )}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', cursor: 'crosshair', overflow: 'visible' }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="bmgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map(t => (
          <g key={t}>
            <line x1={PAD.l} y1={toY(t)} x2={PAD.l + iw} y2={toY(t)} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.l - 5} y={toY(t) + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)" fontFamily="monospace">{t}</text>
          </g>
        ))}
        {markerIdx.map((m, i) => (
          <g key={i}>
            <line x1={toX(m.idx)} y1={PAD.t} x2={toX(m.idx)} y2={PAD.t + ih} stroke="var(--text-muted)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
            <text x={toX(m.idx)} y={PAD.t + 8} textAnchor="middle" fontSize="8" fill="var(--text-muted)" fontFamily="monospace">{m.label}</text>
          </g>
        ))}
        <polygon points={area} fill="url(#bmgrad)" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        {hover != null && (
          <g>
            <line x1={toX(hover)} y1={PAD.t} x2={toX(hover)} y2={PAD.t + ih} stroke="var(--text-muted)" strokeWidth="0.5" />
            <circle cx={toX(hover)} cy={toY(history[hover].value)} r="3.5" fill={color} stroke="var(--card-bg)" strokeWidth="1.5" />
          </g>
        )}
      </svg>
    </div>
  )
}

export default function Overview() {
  const [bm, setBm] = useState<BreakMeter | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/breakmeter')
      .then(r => r.json())
      .then(d => { setBm(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const color = bm ? (LEVEL_COLORS[bm.level] || '#639922') : '#639922'

  // Gauge geometry
  const R = 64, CX = 80, CY = 80
  const total = bm?.total ?? 0
  const angle = Math.PI * (1 - total / 100)
  const endX = CX + R * Math.cos(angle), endY = CY - R * Math.sin(angle)

  return (
    <div>
      {/* ── Break Meter headline ── */}
      <div className="bm-hero">
        <div className="bm-gauge">
          <svg width="160" height="96" viewBox="0 0 160 96">
            <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${CX+R} ${CY}`} fill="none" stroke="var(--border-med)" strokeWidth="9" strokeLinecap="round" />
            {bm && <path d={`M ${CX-R} ${CY} A ${R} ${R} 0 0 1 ${endX.toFixed(1)} ${endY.toFixed(1)}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />}
            <text x={CX} y={CY-6} textAnchor="middle" fontSize="32" fontWeight="500" fontFamily="var(--mono)" fill="var(--text-primary)">{bm ? bm.total : '—'}</text>
            <text x={CX} y={CY+11} textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-muted)">/ 100</text>
          </svg>
          <div className="bm-label">The Break Meter</div>
          {bm && <div className="bm-verdict" style={{ color }}>{bm.verdict}</div>}
        </div>
        <div className="bm-trend">
          {bm && <BreakMeterTrend history={bm.history} color={color} />}
        </div>
      </div>

      {/* ── Two-panel row ── */}
      <div className="panels">
        {/* What Changed */}
        <div className="panel">
          <div className="panel-title">What changed this week</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.whatChanged.length === 0 && <div className="panel-empty">Quiet week — no major moves.</div>}
          {bm && bm.whatChanged.map(row => {
            const c = row.direction === 'toward-danger' ? '#A32D2D' : row.direction === 'toward-safety' ? '#3B6D11' : 'var(--text-secondary)'
            const arrow = row.current > row.weekAgo ? '→' : '→'
            return (
              <div className="change-row" key={row.key}>
                <div className="change-main">
                  <span className="change-label">{row.label}</span>
                  <span className="change-why">{row.why}</span>
                </div>
                <div className="change-vals" style={{ color: c }}>
                  {fmt(row.key, row.weekAgo)}{row.unit} <span style={{ opacity: 0.5 }}>{arrow}</span> <strong>{fmt(row.key, row.current)}{row.unit}</strong>
                </div>
              </div>
            )
          })}
        </div>

        {/* Drivers of Stress */}
        <div className="panel">
          <div className="panel-title">Drivers of the Break Meter</div>
          {loading && <div className="panel-loading">Loading…</div>}
          {bm && bm.drivers.map(d => (
            <div className="driver-row" key={d.key}>
              <div className="driver-head">
                <span className="driver-label">{d.label}</span>
                <span className="driver-pct" style={{ color: CAT_COLORS[d.status] }}>{d.shareOfTotal}%</span>
              </div>
              <div className="driver-bar">
                <div className="driver-fill" style={{ width: `${d.shareOfTotal}%`, background: CAT_COLORS[d.status] }} />
              </div>
            </div>
          ))}
          {bm && <div className="driver-note">Share of current Break Meter reading. Biggest pressure sources first.</div>}
        </div>
      </div>

      <style>{`
        .bm-hero { display: flex; gap: 1.75rem; align-items: center; background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1.5rem; margin-bottom: 1rem; flex-wrap: wrap; }
        .bm-gauge { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .bm-label { font-size: 11px; font-weight: 500; letter-spacing: 0.04em; color: var(--text-secondary); font-family: var(--mono); margin-top: 4px; }
        .bm-verdict { font-size: 13px; font-weight: 500; text-align: center; max-width: 150px; }
        .bm-trend { flex: 1; min-width: 260px; }

        .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        @media (max-width: 640px) { .panels { grid-template-columns: 1fr; } .bm-hero { justify-content: center; } }
        .panel { background: var(--card-bg); border: 0.5px solid var(--border); border-radius: 10px; padding: 1.25rem; }
        .panel-title { font-size: 10px; font-weight: 500; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); font-family: var(--mono); margin-bottom: 12px; }
        .panel-loading, .panel-empty { font-size: 12px; color: var(--text-muted); font-family: var(--mono); padding: 1rem 0; }

        .change-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 0.5px solid var(--border); gap: 10px; }
        .change-row:last-child { border-bottom: none; padding-bottom: 0; }
        .change-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .change-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
        .change-why { font-size: 11px; color: var(--text-muted); }
        .change-vals { font-family: var(--mono); font-size: 12px; white-space: nowrap; }

        .driver-row { margin-bottom: 11px; }
        .driver-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
        .driver-label { font-size: 12px; color: var(--text-secondary); }
        .driver-pct { font-size: 12px; font-family: var(--mono); font-weight: 500; }
        .driver-bar { height: 6px; background: var(--border-med); border-radius: 3px; overflow: hidden; }
        .driver-fill { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
        .driver-note { font-size: 10px; color: var(--text-muted); margin-top: 10px; line-height: 1.4; }
      `}</style>
    </div>
  )
}
