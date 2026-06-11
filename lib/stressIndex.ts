// lib/stressIndex.ts
// Computes a 0–100 stress index from current macro data.
// Each category contributes stress up to its weight ceiling, scaled by how
// stressed its indicators currently are (percentile-based, direction-aware).

import type { MacroData } from './fetchData'
import { INDICATORS } from './thresholds'

// ── Danger profiles ──────────────────────────────────────────────────
// 'high-bad'     → stress rises as value rises (VIX, spreads, inflation, claims)
// 'low-bad'      → stress rises as value falls (yield curve inversion)
// 'extremes-bad' → stress rises as value moves away from historical median
//                  in EITHER direction (rates near zero OR very high = stress)
type DangerProfile = 'high-bad' | 'low-bad' | 'extremes-bad'

type CategoryDef = {
  key: string
  label: string
  weight: number           // max stress contribution
  indicators: { key: string; profile: DangerProfile }[]
}

// Weights sum to 100
export const CATEGORIES: CategoryDef[] = [
  {
    key: 'bonds',
    label: 'Bond Market',
    weight: 25,
    indicators: [
      { key: 'treasury10y', profile: 'extremes-bad' },  // danger at both ends
      { key: 'yieldCurve',  profile: 'low-bad' },        // inversion = danger
    ],
  },
  {
    key: 'housing',
    label: 'Housing',
    weight: 20,
    // 30-year mortgage rate drives housing affordability. extremes-bad:
    // very high rates choke affordability; very low rates signal crisis-era
    // emergency policy (2021's record lows preceded a frozen market).
    indicators: [
      { key: 'mortgage30', profile: 'extremes-bad' },
    ],
  },
  {
    key: 'labor',
    label: 'Labor',
    weight: 20,
    indicators: [
      { key: 'joblessClaims', profile: 'high-bad' },
    ],
  },
  {
    key: 'credit',
    label: 'Credit',
    weight: 15,
    indicators: [
      { key: 'hySpread', profile: 'high-bad' },
      { key: 'igSpread', profile: 'high-bad' },
    ],
  },
  {
    key: 'inflation',
    label: 'Inflation',
    weight: 10,
    indicators: [
      { key: 'cpi', profile: 'extremes-bad' },  // deflation AND high inflation are both bad
    ],
  },
  {
    key: 'stocks',
    label: 'Stocks & Volatility',
    weight: 10,
    indicators: [
      { key: 'vix', profile: 'high-bad' },
    ],
  },
]

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

// Returns a 0–1 stress fraction for a single indicator given its danger profile
export function indicatorStress(key: string, value: number, profile: DangerProfile): number {
  const ind = INDICATORS.find(i => i.key === key)
  if (!ind?.history) return 0
  const [min, low10, median, high90, max] = ind.history

  // Normalize value to 0–1 across full historical range
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min || 1)))

  switch (profile) {
    case 'high-bad':
      // Linear: bottom of range = 0 stress, top = full stress
      return norm
    case 'low-bad':
      // Inverted: bottom of range = full stress, top = 0 stress
      return 1 - norm
    case 'extremes-bad': {
      // U-shaped: stress = distance from median, scaled to each side
      if (value <= median) {
        // Below median — how far toward the low extreme
        const span = median - min || 1
        return Math.max(0, Math.min(1, (median - value) / span))
      } else {
        // Above median — how far toward the high extreme
        const span = max - median || 1
        return Math.max(0, Math.min(1, (value - median) / span))
      }
    }
  }
}

export type CategoryStress = {
  key: string
  label: string
  weight: number
  contribution: number    // actual points contributed (0 to weight)
  fillPct: number         // contribution / weight, as 0–100
  shareOfTotal: number    // contribution / index total, as 0–100 (Drivers panel)
  status: 'calm' | 'elevated' | 'stressed' | 'breaking'
}

export type StressResult = {
  total: number           // 0–100
  level: 'calm' | 'guarded' | 'elevated' | 'high' | 'severe'
  verdict: string
  categories: CategoryStress[]
}

function categoryStatus(fillPct: number): CategoryStress['status'] {
  if (fillPct >= 75) return 'breaking'
  if (fillPct >= 50) return 'stressed'
  if (fillPct >= 25) return 'elevated'
  return 'calm'
}

function indexLevel(total: number): { level: StressResult['level']; verdict: string } {
  if (total < 20) return { level: 'calm', verdict: 'No — conditions are calm' }
  if (total < 35) return { level: 'guarded', verdict: 'No — but worth watching' }
  if (total < 50) return { level: 'elevated', verdict: 'Not yet — stress is building' }
  if (total < 70) return { level: 'high', verdict: 'Getting close — multiple stress points' }
  return { level: 'severe', verdict: 'Yes — broad systemic stress' }
}

// Compute just the total stress (0–100) from a plain map of indicator values.
// Used by the historical backfill, which reconstructs the index for past dates.
export function computeStressFromValues(values: Record<string, number | null>): number {
  let total = 0
  for (const cat of CATEGORIES) {
    const stresses: number[] = []
    for (const ind of cat.indicators) {
      const value = values[ind.key]
      if (value != null) stresses.push(indicatorStress(ind.key, value, ind.profile))
    }
    const avgStress = stresses.length ? stresses.reduce((a, b) => a + b, 0) / stresses.length : 0
    total += avgStress * cat.weight
  }
  return Math.round(total)
}

export function computeStressIndex(data: MacroData): StressResult {
  const categories: CategoryStress[] = CATEGORIES.map(cat => {
    // Average the stress across the category's indicators
    const stresses: number[] = []
    for (const ind of cat.indicators) {
      const value = getValueForKey(data, ind.key)
      if (value != null) stresses.push(indicatorStress(ind.key, value, ind.profile))
    }
    const avgStress = stresses.length ? stresses.reduce((a, b) => a + b, 0) / stresses.length : 0
    const contribution = parseFloat((avgStress * cat.weight).toFixed(1))
    const fillPct = parseFloat((avgStress * 100).toFixed(0))
    return {
      key: cat.key,
      label: cat.label,
      weight: cat.weight,
      contribution,
      fillPct,
      shareOfTotal: 0, // filled in below once total is known
      status: categoryStatus(fillPct),
    }
  })

  const rawTotal = categories.reduce((sum, c) => sum + c.contribution, 0)
  const total = Math.round(rawTotal)

  // Share of total — each category's slice of the current stress (Drivers panel)
  for (const c of categories) {
    c.shareOfTotal = rawTotal > 0 ? Math.round((c.contribution / rawTotal) * 100) : 0
  }
  // Sort so biggest drivers come first
  categories.sort((a, b) => b.contribution - a.contribution)

  const { level, verdict } = indexLevel(total)

  return { total, level, verdict, categories }
}
