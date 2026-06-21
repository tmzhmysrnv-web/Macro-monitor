// components/app/InterestCard.tsx
// One watchlist card per followed topic: icon + title + calm status badge, the
// topic's live metric rows, a small trend sparkline, and a one-line insight.
// Clicking opens the full intelligence tab on the public site.
import Icon from '../Icon'
import { INDICATORS, type AlertStatus } from '../../lib/thresholds'
import type { InterestDef, InterestReading } from '../../lib/interests'

const BADGE_CLASS: Record<AlertStatus, string> = { ok: 'badge-ok', warn: 'badge-warn', alert: 'badge-alert' }
const SPARK_COLOR: Record<AlertStatus, string> = { ok: 'var(--c-ok)', warn: 'var(--c-warn)', alert: 'var(--c-bad)' }

export function formatMetric(key: string, v: number | null): string {
  if (v == null) return '—'
  if (key === 'sp500') return v.toLocaleString('en-US')
  if (key === 'gold') return `$${v.toLocaleString('en-US')}`
  if (key === 'oil' || key === 'silver') return `$${v.toFixed(2)}`
  if (key === 'copper') return `$${v.toFixed(3)}`
  if (key === 'dxy') return v.toFixed(2)
  if (key === 'vix') return v.toFixed(1)
  if (key === 'joblessClaims') return `${v.toFixed(0)}k`
  if (key === 'payrolls') return `${v > 0 ? '+' : ''}${Math.round(v)}k`
  if (key === 'yieldCurve' || key === 'homePriceYoY') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  return `${v.toFixed(2)}%`
}

const labelFor = (key: string) => INDICATORS.find(i => i.key === key)?.label ?? key

function MiniSpark({ points, color }: { points: number[]; color: string }) {
  if (!points || points.length < 2) return null
  const W = 240, H = 40
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1
  const d = points.map((v, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="40" preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
      <polyline points={d.join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function InterestCard({
  def, reading, values, series, onOpen,
}: {
  def: InterestDef
  reading: InterestReading
  values: Record<string, number | null>
  series?: number[]
  onOpen: () => void
}) {
  const rows = def.metrics.filter(k => values[k] != null).slice(0, 4)
  return (
    <button type="button" className="ic" onClick={onOpen}>
      <div className="ic-head">
        <span className="ic-icon"><Icon name={def.icon} size={22} /></span>
        <div className="ic-titles">
          <div className="ic-title">{def.label}</div>
          <span className={`badge ${BADGE_CLASS[reading.status]}`}>{reading.badge}</span>
        </div>
      </div>

      <div className="ic-rows">
        {rows.map(k => (
          <div key={k} className="ic-row"><span>{labelFor(k)}</span><b>{formatMetric(k, values[k])}</b></div>
        ))}
      </div>

      {series && series.length >= 2 && (
        <div className="ic-spark"><MiniSpark points={series} color={SPARK_COLOR[reading.status]} /></div>
      )}

      <div className={`ic-insight ${reading.status === 'ok' ? '' : reading.status === 'warn' ? 'warn' : 'alert'}`}>
        <b>Insight:</b> {reading.insight}
      </div>

      <style>{`
        .ic { display: block; width: 100%; text-align: left; cursor: pointer; background: var(--c-surface);
          border: 1px solid var(--c-border); border-radius: 16px; padding: 18px; transition: border-color .15s, box-shadow .15s; font-family: var(--c-sans); }
        .ic:hover { border-color: var(--c-border-strong); box-shadow: 0 4px 16px rgba(20,40,30,.05); }
        .ic-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .ic-icon { width: 40px; height: 40px; border-radius: 11px; background: var(--c-soft); color: var(--c-green-deep);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ic-titles { min-width: 0; }
        .ic-title { font-size: 16px; font-weight: 600; color: var(--c-text); }
        .ic-titles .badge { margin-top: 3px; }
        .ic-rows { display: flex; flex-direction: column; gap: 8px; }
        .ic-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13.5px; color: var(--c-text-soft); }
        .ic-row b { color: var(--c-text); font-weight: 500; font-family: var(--c-mono); font-size: 13px; }
        .ic-spark { margin: 14px 0 4px; }
        .ic-insight { margin-top: 12px; font-size: 12.5px; line-height: 1.5; color: var(--c-text-soft);
          background: var(--c-soft); border-radius: 10px; padding: 11px 13px; }
        .ic-insight.warn { background: var(--c-warn-bg); }
        .ic-insight.alert { background: var(--c-bad-bg); }
        .ic-insight b { color: var(--c-text); font-weight: 600; }
      `}</style>
    </button>
  )
}
