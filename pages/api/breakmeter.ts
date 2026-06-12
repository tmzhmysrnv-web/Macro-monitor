// pages/api/breakmeter.ts
// The Overview's early-warning payload: Break Meter score + 10yr trend, plus the
// derived intelligence that actually answers "is the world breaking?" —
// active alerts, recent breaks, what's nearest to breaking, drivers, and a
// one-line situation briefing.
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData } from '../../lib/fetchData'
import { computeStressIndex } from '../../lib/stressIndex'
import { backfillBreakMeter } from '../../lib/backfill'
import { buildWhatChanged } from '../../lib/whatChanged'
import { fetchAllHistory } from '../../lib/fetchHistory'
import { buildAlerts, buildWatching, buildRecentBreaks, buildBriefing } from '../../lib/overview'

// Cache the expensive backfill in module memory (recomputed on cold start)
let cachedBackfill: { points: { date: string; value: number }[]; at: number } | null = null
const BACKFILL_TTL = 24 * 60 * 60 * 1000 // 24h

const BREAK_INPUTS = ['vix', 'treasury10y', 'yieldCurve', 'cpi', 'joblessClaims', 'hySpread', 'igSpread', 'mortgage30', 'homePriceYoY'] as const

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const data = await fetchAllData()
    const available = BREAK_INPUTS.filter(k => (data as Record<string, unknown>)[k] != null).length >= 3
    const current = computeStressIndex(data)

    // Per-indicator history (shared by what-changed + recent-breaks)
    const history = await fetchAllHistory()

    // Backfill the meter line (cached)
    let line = cachedBackfill?.points
    if (!line || Date.now() - (cachedBackfill?.at || 0) > BACKFILL_TTL) {
      line = await backfillBreakMeter()
      cachedBackfill = { points: line, at: Date.now() }
    }
    // Append today's live reading to the historical line
    const today = new Date().toISOString().split('T')[0]
    const historyWithToday = [...line.filter(p => p.date.slice(0, 7) !== today.slice(0, 7)), { date: today, value: current.total }]

    const whatChanged = await buildWhatChanged(data, history)
    const alerts = buildAlerts(data)
    const watching = buildWatching(data)
    const recentBreaks = buildRecentBreaks(history)
    const briefing = buildBriefing(current)

    // Enrich drivers with a weekly trend arrow + rough contribution share
    const changeByKey = new Map(whatChanged.map(r => [r.key, r.direction]))
    const sumStress = current.categories.reduce((a, c) => a + c.stress, 0) || 1
    const drivers = current.categories.map(c => {
      const dir = changeByKey.get(c.driverKey)
      const trend: 'up' | 'down' | 'flat' = dir === 'toward-danger' ? 'up' : dir === 'toward-safety' ? 'down' : 'flat'
      return { ...c, trend, share: Math.round((c.stress / sumStress) * 100) }
    })

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      available,
      total: current.total,
      level: current.level,
      verdict: current.verdict,
      drivers,
      history: historyWithToday,
      whatChanged,
      alerts,
      watching,
      recentBreaks,
      briefing,
      concern: briefing.concern,
    })
  } catch (err) {
    console.error('Break meter error:', err)
    res.status(500).json({ error: 'Failed to compute break meter' })
  }
}
