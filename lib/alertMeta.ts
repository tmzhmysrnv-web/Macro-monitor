// lib/alertMeta.ts
// Per-alert metadata for the email digest's value-vs-threshold bar and the
// "what we're watching next" line. Kept here (not in the 7 model libs) so the
// email can be enriched without editing — and risking reverting — those files.
// Thresholds mirror each lib's buildAlerts; `dir` is the breach direction.

import type { FiredAlert } from './alertEngine'

type Dir = 'above' | 'below'
export type AlertMeta = { t: number; unit: string; dir: Dir; next?: string }

export const ALERT_META: Record<string, AlertMeta> = {
  // inflation
  'cpi-severe': { t: 8, unit: '%', dir: 'above' },
  'cpi-5': { t: 5, unit: '%', dir: 'above', next: 'Above 8% would mark a severe-inflation regime.' },
  'cpi-4': { t: 4, unit: '%', dir: 'above', next: 'A move above 5% would escalate this.' },
  'core-4': { t: 4, unit: '%', dir: 'above', next: 'Sticky core keeps the Fed restrictive.' },
  'wti-shock': { t: 120, unit: '$', dir: 'above' },
  'wti-100': { t: 100, unit: '$', dir: 'above', next: 'Above $120 becomes an energy shock.' },
  // labor
  'sahm': { t: 0.5, unit: 'pp', dir: 'above', next: 'A deeper rise confirms a downturn.' },
  'unemp-5': { t: 5, unit: '%', dir: 'above', next: 'Each further rise widens the damage.' },
  'claims-high': { t: 300, unit: 'k', dir: 'above', next: 'Above ~375k signals faster deterioration.' },
  'cc-stress': { t: 2, unit: 'M', dir: 'above' },
  'payroll-slow': { t: 50, unit: 'k', dir: 'below', next: 'Negative prints would signal contraction.' },
  // markets
  'sp-bear': { t: 20, unit: '%', dir: 'above' },
  'sp-correction': { t: 10, unit: '%', dir: 'above', next: 'A 20% fall would be a bear market.' },
  'vix-40': { t: 40, unit: '', dir: 'above' },
  'vix-30': { t: 30, unit: '', dir: 'above', next: 'Above 40 is panic territory.' },
  'market-selloff': { t: 2.5, unit: '%', dir: 'above', next: 'A second down day would deepen it.' },
  'breadth-weak': { t: 6, unit: 'pp', dir: 'above' },
  // global
  'dxy-stress': { t: 6, unit: '%', dir: 'above' },
  'dxy-warn': { t: 107, unit: '', dir: 'above', next: 'A faster surge becomes a stress event.' },
  'oil-shock': { t: 120, unit: '$', dir: 'above' },
  'oil-100': { t: 100, unit: '$', dir: 'above', next: 'Above $120 is a supply shock.' },
  'copper-slump': { t: 12, unit: '%', dir: 'above' },
  'em-contagion': { t: 25, unit: '%', dir: 'above' },
  'em-stress': { t: 15, unit: '%', dir: 'above', next: 'A 25% drop signals contagion.' },
  // bonds
  'tenY-5': { t: 5, unit: '%', dir: 'above' },
  'thirtY-6': { t: 6, unit: '%', dir: 'above' },
  'term-premium': { t: 1.0, unit: '%', dir: 'above' },
  'deep-inversion': { t: 1.0, unit: '%', dir: 'above' },
  'vol-stress': { t: 13, unit: 'bp', dir: 'above' },
  'yield-spike': { t: 25, unit: 'bp', dir: 'above', next: 'Above 40bp/week is disorderly.' },
  // credit
  'hy-7': { t: 7, unit: '%', dir: 'above' },
  'hy-5': { t: 5, unit: '%', dir: 'above', next: 'Above 7% signals real credit stress.' },
  'nfci-tight': { t: 0.3, unit: '', dir: 'above' },
  'cre-distress': { t: 3, unit: '%', dir: 'above' },
  // housing
  'mortgage-8': { t: 8, unit: '%', dir: 'above' },
  'mortgage-7': { t: 7, unit: '%', dir: 'above', next: 'Above 8% freezes most buying.' },
  'supply-tight': { t: 3, unit: 'mo', dir: 'below' },
  'sales-drop': { t: 10, unit: '%', dir: 'above' },
  'newsales-drop': { t: 15, unit: '%', dir: 'above' },
  'delinq-spike': { t: 20, unit: '%', dir: 'above' },
}

export type AlertBar = { value: number; threshold: number; unit: string; dir: Dir }

// First numeric token in the alert's `what` text (its headline figure).
function parseValue(what: string): number | null {
  const m = what.match(/-?\$?\d[\d,]*\.?\d*/)
  if (!m) return null
  const n = parseFloat(m[0].replace(/[$,]/g, ''))
  return Number.isFinite(n) ? Math.abs(n) : null
}

// Returns bar data only when the parsed figure is consistent with a firing
// alert — guards against grabbing the wrong number (e.g. a level when the alert
// is really about a year-over-year change), in which case we just skip the bar.
export function barFor(alert: FiredAlert): AlertBar | null {
  const meta = ALERT_META[alert.id]
  if (!meta) return null
  const v = parseValue(alert.what)
  if (v == null) return null
  const consistent = meta.dir === 'above' ? v >= meta.t * 0.8 : v <= meta.t * 1.25
  if (!consistent) return null
  return { value: v, threshold: meta.t, unit: meta.unit, dir: meta.dir }
}

export function nextFor(id: string): string | undefined {
  return ALERT_META[id]?.next
}
