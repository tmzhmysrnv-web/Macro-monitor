// components/DriverMetricCard.tsx
// Shared interactive metric card used in the Housing & Bonds "Key drivers"
// detail — same look/feel as the site's indicator cards: chrome, a large mono
// value, a sparkline, and a click-to-expand inline history chart.
import { useState } from 'react'
import Icon from './Icon'

export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'

export type MetricCardData = {
  label: string
  value: string
  sub?: string
  unit?: string
  tone?: Tone            // good/warn/bad sentiment → green/amber/red, like the raw cards
  points?: { date: string; value: number }[] // oldest → newest
  pctl?: number          // 0..100 position of the latest value in its history
  histLabel?: string     // "historically low" / "historically normal" / …
  alertText?: string     // distance to alert, for metrics that have a threshold
  alertProximity?: number // 0..1, 1 = at the alert
}

// Matches the raw indicator cards: green dot = healthy, amber = watch, red =
// stress. Value text is tinted only on the danger side (like the raw cards,
// which leave an "ok" value the default color).
const TONE_DOT: Record<Tone, string> = {
  good: 'var(--good)', neutral: 'var(--text-muted)', warn: 'var(--warn)', bad: 'var(--bad)', crisis: 'var(--crisis)',
}
const TONE_VALUE: Record<Tone, string> = {
  good: 'var(--text-primary)', neutral: 'var(--text-primary)', warn: 'var(--warn)', bad: 'var(--bad)', crisis: 'var(--crisis)',
}

function Sparkline({ vals, color = 'var(--text-secondary)' }: { vals: number[]; color?: string }) {
  const W = 96, H = 26
  const min = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * W).toFixed(1)},${(H - (v - min) / range * H).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', opacity: 0.8 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function ExpandedChart({ points, unit }: { points: { date: string; value: number }[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 520, H = 150, PAD = { t: 12, r: 12, b: 22, l: 38 }
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b
  const vals = points.map(p => p.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const toX = (i: number) => PAD.l + i / (points.length - 1) * iw
  const toY = (v: number) => PAD.t + ih - (v - min) / range * ih
  const line = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ')
  const area = `${line} ${toX(points.length - 1).toFixed(1)},${(PAD.t + ih).toFixed(1)} ${PAD.l},${(PAD.t + ih).toFixed(1)}`
  const fmtV = (v: number) => `${(Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))}${unit ?? ''}`

  function move(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = (e.clientX - r.left) * (W / r.width)
    const idx = Math.round((mx - PAD.l) / iw * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, idx)))
  }
  const hv = hover != null ? points[hover] : null
  const yTicks = [0, 0.5, 1].map(t => ({ y: PAD.t + ih * (1 - t), v: min + range * t }))

  return (
    <div className="dc-chart">
      <div className="dc-chart-read">
        {hv ? <><span className="dc-chart-v">{fmtV(hv.value)}</span><span className="dc-chart-d">{hv.date}</span></>
            : <span className="dc-chart-d">Hover to explore · {points.length} points</span>}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', cursor: 'crosshair', overflow: 'visible' }} onMouseMove={move} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="dcgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--text-secondary)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--text-secondary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} y1={t.y} x2={PAD.l + iw} y2={t.y} stroke="var(--border)" strokeWidth="0.5" />
            <text x={PAD.l - 5} y={t.y + 3} textAnchor="end" fontSize="8" fill="var(--text-muted)" fontFamily="monospace">{Math.abs(t.v) >= 100 ? t.v.toFixed(0) : t.v.toFixed(1)}</text>
          </g>
        ))}
        <polygon points={area} fill="url(#dcgrad)" />
        <polyline points={line} fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinejoin="round" />
        {hover != null && (
          <g>
            <line x1={toX(hover)} y1={PAD.t} x2={toX(hover)} y2={PAD.t + ih} stroke="var(--text-muted)" strokeWidth="0.5" />
            <circle cx={toX(hover)} cy={toY(points[hover].value)} r="3.2" fill="var(--text-primary)" stroke="var(--card-bg)" strokeWidth="1.5" />
          </g>
        )}
      </svg>
    </div>
  )
}

export default function DriverMetricCard({ m }: { m: MetricCardData }) {
  const [open, setOpen] = useState(false)
  const pts = m.points && m.points.length >= 2 ? m.points : null
  const clickable = !!pts
  return (
    <div
      className={`dc ${clickable ? 'dc-click' : ''}`}
      onClick={clickable ? (e) => { e.stopPropagation(); setOpen(o => !o) } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } } : undefined}
    >
      <div className="dc-top">
        <span className="dc-label">
          {m.tone && <span className="dc-dot" style={{ background: TONE_DOT[m.tone] }} />}
          {m.label}
        </span>
        {clickable && <span className="dc-expand">{open ? '▾' : '↗'}</span>}
      </div>
      <div className="dc-mid">
        <div>
          <div className="dc-value" style={m.tone ? { color: TONE_VALUE[m.tone] } : undefined}>{m.value}</div>
          {m.sub && <div className="dc-sub">{m.sub}</div>}
        </div>
        {pts && !open && <Sparkline vals={pts.map(p => p.value)} color={m.tone ? TONE_DOT[m.tone] : undefined} />}
      </div>

      {m.pctl != null && (
        <div className="dc-pctl">
          <div className="dc-pctl-top">
            <span>{m.histLabel ?? `${m.pctl}th pct`}</span>
            <span>range</span>
          </div>
          <div className="dc-pctl-track">
            <div className="dc-pctl-fill" style={{ width: `${m.pctl}%` }} />
            <div className="dc-pctl-dot" style={{ left: `${m.pctl}%` }} />
          </div>
        </div>
      )}
      {m.alertText && (
        <div className="dc-alert" style={{ color: (m.alertProximity ?? 0) > 0.85 ? 'var(--bad)' : (m.alertProximity ?? 0) > 0.6 ? 'var(--warn)' : 'var(--text-muted)' }}>
          <Icon name={(m.alertProximity ?? 0) > 0.7 ? 'flame' : 'alert-triangle'} size={13} style={{ display: 'inline-block', verticalAlign: -2, marginRight: 4 }} />{m.alertText}
        </div>
      )}

      {pts && open && <ExpandedChart points={pts} unit={m.unit} />}

      <style>{`
        .dc { background: var(--bg); border: 0.5px solid var(--border); border-radius: 8px; padding: 9px 11px; transition: border-color 0.15s; }
        .dc-click { cursor: pointer; }
        .dc-click:hover { border-color: var(--border-med); }
        .dc-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 5px; }
        .dc-label { font-size: 10px; color: var(--text-muted); line-height: 1.3; display: inline-flex; align-items: center; gap: 5px; }
        .dc-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .dc-expand { font-size: 10px; color: var(--text-muted); opacity: 0.55; }
        .dc-click:hover .dc-expand { opacity: 1; }
        .dc-mid { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
        .dc-value { font-size: 17px; font-weight: 500; font-family: var(--mono); color: var(--text-primary); line-height: 1.05; }
        .dc-sub { font-size: 10px; color: var(--text-muted); font-family: var(--mono); margin-top: 2px; }
        .dc-pctl { margin-top: 8px; }
        .dc-pctl-top { display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); font-family: var(--mono); margin-bottom: 3px; }
        .dc-pctl-track { position: relative; height: 3px; background: var(--border-med); border-radius: 2px; }
        .dc-pctl-fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--text-secondary); opacity: 0.45; border-radius: 2px; }
        .dc-pctl-dot { position: absolute; top: -2px; width: 7px; height: 7px; border-radius: 50%; background: var(--text-secondary); border: 1.5px solid var(--bg); transform: translateX(-50%); }
        .dc-alert { margin-top: 7px; font-size: 10.5px; font-family: var(--mono); }
        .dc-chart { margin-top: 10px; }
        .dc-chart-read { display: flex; justify-content: space-between; align-items: baseline; font-family: var(--mono); margin-bottom: 4px; }
        .dc-chart-v { font-size: 12px; font-weight: 500; color: var(--text-primary); }
        .dc-chart-d { font-size: 10px; color: var(--text-muted); }
      `}</style>
    </div>
  )
}
