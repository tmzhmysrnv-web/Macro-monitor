// lib/backfill.ts
// Reconstructs the Break Meter over 10 years of history by running the current
// stress formula backward over historical indicator values.

import { fetchAllHistory, type DataPoint, type HistoryMap } from './fetchHistory'
import { computeStressFromValues, BREAK_KEYS } from './stressIndex'

export type BreakMeterPoint = { date: string; value: number }

// Keys the Break Meter actually reads
function neededKeys(): string[] {
  return BREAK_KEYS
}

// Build a date→value lookup for a series, forward-filling gaps so monthly
// series (CPI, fed funds) align with weekly/daily ones.
function indexByMonth(series: DataPoint[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const pt of series) {
    const ym = pt.date.slice(0, 7) // YYYY-MM
    m.set(ym, pt.value) // last value in month wins
  }
  return m
}

// Pass a preloaded history to avoid re-fetching; defaults to monthly 10y, which
// is all the long-range trend needs.
export async function backfillBreakMeter(preloaded?: HistoryMap): Promise<BreakMeterPoint[]> {
  const history = preloaded ?? await fetchAllHistory(10, 'm')
  const keys = neededKeys()

  // Index each needed series by month
  const monthMaps: Record<string, Map<string, number>> = {}
  for (const key of keys) {
    if (history[key]) monthMaps[key] = indexByMonth(history[key])
  }

  // Collect the union of all months present, sorted
  const allMonths = new Set<string>()
  for (const key of keys) {
    const m = monthMaps[key]
    if (m) for (const ym of m.keys()) allMonths.add(ym)
  }
  const months = Array.from(allMonths).sort()

  // For each month, assemble a value map (forward-filling last known value)
  const lastKnown: Record<string, number | null> = {}
  for (const key of keys) lastKnown[key] = null

  const points: BreakMeterPoint[] = []
  for (const ym of months) {
    for (const key of keys) {
      const m = monthMaps[key]
      if (m && m.has(ym)) lastKnown[key] = m.get(ym)!
    }
    // Only compute once we have at least the heaviest signals populated
    const populated = keys.filter(k => lastKnown[k] != null).length
    if (populated < Math.ceil(keys.length * 0.6)) continue

    const value = computeStressFromValues({ ...lastKnown })
    points.push({ date: `${ym}-01`, value })
  }

  return points
}
