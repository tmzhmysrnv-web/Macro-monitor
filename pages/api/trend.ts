// pages/api/trend.ts
// The Break Meter's 10-year trend, reconstructed from monthly history. Split
// out of /api/breakmeter so the slow backfill never blocks the gauge, alerts,
// and drivers from painting. The client appends today's live reading.
import type { NextApiRequest, NextApiResponse } from 'next'
import { backfillBreakMeter } from '../../lib/backfill'
import { fetchAllHistory } from '../../lib/fetchHistory'

// Cache the reconstruction in module memory across requests on a warm instance.
let cached: { points: { date: string; value: number }[]; at: number } | null = null
const TTL = 24 * 60 * 60 * 1000 // 24h — the long-range trend barely moves day to day

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    let points = cached?.points
    if (!points || Date.now() - (cached?.at || 0) > TTL) {
      const history = await fetchAllHistory(10, 'm') // monthly, ~120 points/series
      points = await backfillBreakMeter(history)
      cached = { points, at: Date.now() }
    }
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400')
    res.status(200).json({ history: points })
  } catch (err) {
    console.error('Trend error:', err)
    res.status(500).json({ error: 'Failed to build trend' })
  }
}
