// pages/api/housing.ts
// Returns the full housing model: headline status, category drivers, a
// deterministic plain-English briefing, alerts, and watching-closely items.
// No external AI — the briefing is assembled from the computed statuses.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildHousingModel, type HousingModel } from '../../lib/housing'

// Deterministic briefing composed from the category statuses + risk callout.
function buildSummary(m: HousingModel): string {
  if (!m.available) return 'Live housing data is temporarily unavailable. Check back shortly.'
  const by: Record<string, string> = Object.fromEntries(m.categories.map(c => [c.key, c.status]))
  const themes = `Affordability is ${(by.affordability || '').toLowerCase()}, supply ${(by.supply || '').toLowerCase()}, demand ${(by.demand || '').toLowerCase()}, and financial stress ${(by.stress || '').toLowerCase()}.`
  return [themes, m.risk.text].filter(Boolean).join(' ')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const model = await buildHousingModel()
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      available: model.available,
      status: model.status,
      subtitle: model.subtitle,
      summary: buildSummary(model),
      risk: model.risk,
      stabilizer: model.stabilizer,
      categories: model.categories,
      alerts: model.alerts,
      lastAlert: model.lastAlert,
      watching: model.watching,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Housing model error:', err)
    res.status(500).json({ error: 'Failed to build housing model' })
  }
}
