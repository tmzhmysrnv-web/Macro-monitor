// pages/api/markets.ts
// Returns the markets intelligence model: overall status, four-theme scorecard,
// a deterministic 75–125 word briefing, a "what investors are doing" takeaway,
// alerts, last-alert, and watching-closely items. No external AI.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildMarketsModel } from '../../lib/markets'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const model = await buildMarketsModel()
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      available: model.available,
      status: model.status,
      subtitle: model.subtitle,
      summary: model.summary,
      doing: model.doing,
      risk: model.risk,
      stabilizer: model.stabilizer,
      categories: model.categories,
      alerts: model.alerts,
      lastAlert: model.lastAlert,
      watching: model.watching,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Markets model error:', err)
    res.status(500).json({ error: 'Failed to build markets model' })
  }
}
