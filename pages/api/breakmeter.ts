// pages/api/breakmeter.ts
// The Overview's fast early-warning payload: Break Meter score + the derived
// intelligence that answers "is the world breaking?" — active alerts, recent
// breaks, what's nearest to breaking, drivers, and a one-line briefing.
// The slow 10-year trend lives in /api/trend so it doesn't block this.
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData } from '../../lib/fetchData'
import { computeStressIndex } from '../../lib/stressIndex'
import { buildWhatChanged } from '../../lib/whatChanged'
import { backfillBreakMeter } from '../../lib/backfill'
import { fetchAllHistory } from '../../lib/fetchHistory'
import { buildAlerts, buildWatching, buildRecentBreaks, buildBriefing, buildTrendDirections, buildMeterChange, buildDriverTrends } from '../../lib/overview'

const BREAK_INPUTS = ['vix', 'treasury10y', 'yieldCurve', 'cpi', 'joblessClaims', 'hySpread', 'igSpread', 'mortgage30', 'homePriceYoY'] as const

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
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
    // Fresh trailing-year trend, reconstructed from the 1y history we already
    // fetched (no extra calls). The deep history is a committed static snapshot;
    // the client stitches: snapshot (old) → recentTrend (last ~12mo) → live tip.
    const recentTrend = await backfillBreakMeter(history)

    // Enrich drivers with a weekly trend arrow + rough contribution share.
    // Trend = each subsystem's actual stress move over the SAME 7-day window as
    // the headline delta, so an arrow only appears where a subsystem moved (no
    // arrows when the meter is flat week-over-week).
    // A subsystem whose driver is in active alert is floored to "elevated" so
    // it never renders as calm/green while a red alert is firing.
    const RANK = { calm: 0, watch: 1, elevated: 2, stressed: 3, breaking: 4 } as const
    // Only attribute arrows when the meter actually moved over the week — if the
    // headline says "no change this week", show no driver arrows.
    const meterMoved = weekChange != null && weekChange !== 0
    const driverTrends = meterMoved ? buildDriverTrends(history, 7) : {}
    const sumStress = current.categories.reduce((a, c) => a + c.stress, 0) || 1
    const drivers = current.categories.map(c => {
      const trend = driverTrends[c.key] ?? 'flat'
      const status = alertKeys.has(c.driverKey) && RANK[c.status] < RANK.elevated ? 'elevated' : c.status
      return { ...c, status, trend, share: Math.round((c.stress / sumStress) * 100) }
    })

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
    res.status(200).json({
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
    })
  } catch (err) {
    console.error('Break meter error:', err)
    res.status(500).json({ error: 'Failed to compute break meter' })
  }
}
