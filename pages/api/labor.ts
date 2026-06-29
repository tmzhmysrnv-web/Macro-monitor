// pages/api/labor.ts
// Returns the labor-market intelligence model: overall status, four-theme
// scorecard, a deterministic 75–125 word briefing, a "workers are experiencing"
// takeaway, alerts, last-alert, and watching-closely items. No external AI.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildLaborModel } from '../../lib/labor'
import { cacheData } from '../../lib/http'
import { getCached } from '../../lib/redis'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const model = await getCached('labor', 3600, buildLaborModel, m => m.available)
    cacheData(res, model.available, 3600, 86400)
    res.status(200).json({
      available: model.available,
      status: model.status,
      subtitle: model.subtitle,
      summary: model.summary,
      experience: model.experience,
      risk: model.risk,
      stabilizer: model.stabilizer,
      categories: model.categories,
      alerts: model.alerts,
      lastAlert: model.lastAlert,
      watching: model.watching,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Labor model error:', err)
    res.status(500).json({ error: 'Failed to build labor model' })
  }
}
