// pages/api/inflation.ts
// Returns the inflation intelligence model: overall status, four-theme
// scorecard, a deterministic 75–125 word briefing, alerts, last-alert, and
// watching-closely items. No external AI — everything is computed from FRED.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildInflationModel } from '../../lib/inflation'
import { cacheData } from '../../lib/http'
import { getCached } from '../../lib/redis'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const model = await getCached('inflation', 3600, buildInflationModel, m => m.available)
    cacheData(res, model.available, 3600, 86400)
    res.status(200).json({
      available: model.available,
      status: model.status,
      subtitle: model.subtitle,
      summary: model.summary,
      risk: model.risk,
      stabilizer: model.stabilizer,
      categories: model.categories,
      alerts: model.alerts,
      lastAlert: model.lastAlert,
      watching: model.watching,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Inflation model error:', err)
    res.status(500).json({ error: 'Failed to build inflation model' })
  }
}
