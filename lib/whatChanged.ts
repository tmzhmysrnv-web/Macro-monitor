// lib/whatChanged.ts
// Builds the "What Changed This Week" panel — week-over-week moves for each
// indicator, ranked by significance, colored by direction.

import type { MacroData } from './fetchData'
import { fetchAllHistory } from './fetchHistory'
import { INDICATORS } from './thresholds'

export type ChangeRow = {
  key: string
  label: string
  why: string                 // hardcoded plain-language reason
  current: number
  weekAgo: number
  unit: string
  direction: 'toward-danger' | 'toward-safety' | 'neutral'
  significance: number        // for ranking (move size × weight × normalization)
}

// Plain-language "why it matters" per indicator — instant, consistent
const WHY: Record<string, string> = {
  treasury10y:   'Drives borrowing costs',
  mortgage30:    'Sets housing affordability',
  vix:           'Market volatility',
  joblessClaims: 'Labor market health',
  oil:           'Energy & inflation input',
  cpi:           'Cost of living',
  hySpread:      'Corporate credit stress',
  igSpread:      'Early credit warning',
  yieldCurve:    'Recession signal',
  fedfunds:      'Fed policy stance',
  dxy:           'Dollar strength',
  sp500:         'Broad equity market',
  gold:          'Safe-haven demand',
  copper:        'Global growth pulse',
}

// Which direction of movement is "toward danger" for each indicator
const DANGER_UP = new Set(['treasury10y', 'mortgage30', 'vix', 'joblessClaims', 'oil', 'cpi', 'hySpread', 'igSpread', 'dxy'])
const DANGER_DOWN = new Set(['yieldCurve', 'sp500', 'copper'])

function getValueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper,
    mortgage30: data.mortgage30,
  }
  return map[key] ?? null
}

// Per-indicator importance for ranking the biggest weekly movers
const IMPORTANCE: Record<string, number> = {
  hySpread: 25, igSpread: 22, vix: 22, joblessClaims: 20, treasury10y: 18,
  yieldCurve: 18, cpi: 16, mortgage30: 15, sp500: 12, oil: 10, dxy: 10,
  fedfunds: 12, gold: 8, copper: 8,
}
function weightForKey(key: string): number {
  return IMPORTANCE[key] ?? 8
}

export async function buildWhatChanged(data: MacroData): Promise<ChangeRow[]> {
  const history = await fetchAllHistory()
  const rows: ChangeRow[] = []

  for (const ind of INDICATORS) {
    const current = getValueForKey(data, ind.key)
    if (current == null) continue
    const series = history[ind.key]
    if (!series || series.length < 2) continue

    // Find the value ~7 days ago (series may be weekly/monthly — take 2nd to last
    // for weekly, or closest point at least 5 days back)
    const now = new Date()
    let weekAgo: number | null = null
    for (let i = series.length - 1; i >= 0; i--) {
      const d = new Date(series[i].date)
      const daysBack = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
      if (daysBack >= 5) { weekAgo = series[i].value; break }
    }
    if (weekAgo == null) weekAgo = series[series.length - 2]?.value ?? null
    if (weekAgo == null || weekAgo === current) continue

    const pctMove = Math.abs((current - weekAgo) / (weekAgo || 1))
    const wentUp = current > weekAgo
    let direction: ChangeRow['direction'] = 'neutral'
    if (DANGER_UP.has(ind.key)) direction = wentUp ? 'toward-danger' : 'toward-safety'
    else if (DANGER_DOWN.has(ind.key)) direction = wentUp ? 'toward-safety' : 'toward-danger'

    const significance = pctMove * weightForKey(ind.key)

    rows.push({
      key: ind.key,
      label: ind.label,
      why: WHY[ind.key] || '',
      current,
      weekAgo,
      unit: ind.unit,
      direction,
      significance,
    })
  }

  // Rank by significance, biggest movers first
  rows.sort((a, b) => b.significance - a.significance)
  // Return only meaningful movers (top movers + any toward-danger)
  return rows.filter(r => r.significance > 0.001).slice(0, 8)
}
