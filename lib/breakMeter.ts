// lib/breakMeter.ts
// The Break Meter payload — score + the derived "is the world breaking?"
// intelligence (alerts, recent breaks, what's nearest, drivers, briefing).
// Extracted from pages/api/breakmeter.ts so BOTH the /api/breakmeter endpoint
// (dashboard) and the landing-page bundle (lib/bundle.ts) produce the IDENTICAL
// payload — no drift between the two surfaces.
import { fetchAllData } from './fetchData'
import { computeStressIndex } from './stressIndex'
import { buildWhatChanged } from './whatChanged'
import { backfillBreakMeter } from './backfill'
import { fetchAllHistory } from './fetchHistory'
import {
  buildAlerts, buildWatching, buildRecentBreaks, buildBriefing,
  buildTrendDirections, buildMeterChange, buildDriverTrends,
} from './overview'

const BREAK_INPUTS = ['vix', 'treasury10y', 'yieldCurve', 'cpi', 'joblessClaims', 'hySpread', 'igSpread', 'mortgage30', 'homePriceYoY'] as const

export async function buildBreakMeterPayload() {
  const data = await fetchAllData()
  const available = BREAK_INPUTS.filter(k => (data as Record<string, unknown>)[k] != null).length >= 3
  const current = computeStressIndex(data)

  // Only ~1y of history is needed for what-changed (last week) and recent
  // breaks (last ~5 months) — far cheaper than the 10y daily pull.
  const history = await fetchAllHistory(1, 'd')

  const whatChanged = await buildWhatChanged(data, history)
  const alerts = buildAlerts(data)
  const alertKeys = new Set(alerts.map(a => a.key))
  const watching = buildWatching(data)
  const recentBreaks = buildRecentBreaks(history)
  const briefing = buildBriefing(current, alertKeys)
  const directions = buildTrendDirections(data, history)
  const weekChange = buildMeterChange(history, 7) // shared "past 7 days" delta
  const recentTrend = await backfillBreakMeter(history)

  // Enrich drivers with a weekly trend arrow + rough contribution share.
  const RANK = { calm: 0, watch: 1, elevated: 2, stressed: 3, breaking: 4 } as const
  const meterMoved = weekChange != null && weekChange !== 0
  const driverTrends = meterMoved ? buildDriverTrends(history, 7) : {}
  const sumStress = current.categories.reduce((a, c) => a + c.stress, 0) || 1
  const drivers = current.categories.map(c => {
    const trend = driverTrends[c.key] ?? 'flat'
    const status = alertKeys.has(c.driverKey) && RANK[c.status] < RANK.elevated ? 'elevated' : c.status
    return { ...c, status, trend, share: Math.round((c.stress / sumStress) * 100) }
  })

  return {
    available,
    total: current.total,
    level: current.level,
    verdict: current.verdict,
    drivers,
    whatChanged,
    alerts,
    watching,
    recentBreaks,
    briefing,
    directions,
    recentTrend,
    weekChange,
    concern: briefing.concern,
  }
}

export type BreakMeterPayload = Awaited<ReturnType<typeof buildBreakMeterPayload>>
