// pages/api/breakmeter.ts
// Returns current Break Meter + 20yr backfilled history + drivers + what-changed
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData } from '../../lib/fetchData'
import { computeStressIndex } from '../../lib/stressIndex'
import { backfillBreakMeter } from '../../lib/backfill'
import { buildWhatChanged } from '../../lib/whatChanged'

// Cache the expensive backfill in module memory (recomputed on cold start)
let cachedBackfill: { points: { date: string; value: number }[]; at: number } | null = null
const BACKFILL_TTL = 24 * 60 * 60 * 1000 // 24h

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const data = await fetchAllData()
    const current = computeStressIndex(data)

    // Backfill (cached)
    let history = cachedBackfill?.points
    if (!history || Date.now() - (cachedBackfill?.at || 0) > BACKFILL_TTL) {
      history = await backfillBreakMeter()
      cachedBackfill = { points: history, at: Date.now() }
    }

    // Append today's live reading to the historical line
    const today = new Date().toISOString().split('T')[0]
    const historyWithToday = [...history.filter(p => p.date.slice(0, 7) !== today.slice(0, 7)), { date: today, value: current.total }]

    const whatChanged = await buildWhatChanged(data)

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      total: current.total,
      level: current.level,
      verdict: current.verdict,
      drivers: current.categories, // already sorted, with shareOfTotal
      history: historyWithToday,
      whatChanged,
    })
  } catch (err) {
    console.error('Break meter error:', err)
    res.status(500).json({ error: 'Failed to compute break meter' })
  }
}
