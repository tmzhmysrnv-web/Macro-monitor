// pages/api/credit.ts
// Returns the credit-market model: overall status, four-theme scorecard, a
// deterministic plain-English briefing, alerts, and watching-closely items.
// No external AI — the briefing is assembled from the computed statuses.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildCreditModel, type CreditModel } from '../../lib/credit'

function buildSummary(m: CreditModel): string {
  if (!m.available) return 'Live credit-market data is temporarily unavailable. Check back shortly.'
  const by: Record<string, string> = Object.fromEntries(m.categories.map(c => [c.key, c.status]))
  const themes = `Lending conditions are ${(by.lending || '').toLowerCase()}, corporate credit is ${(by.corporate || '').toLowerCase()}, consumer credit is ${(by.consumer || '').toLowerCase()}, and financial-system stress is ${(by.financial || '').toLowerCase()}.`
  return [themes, m.risk.text].filter(Boolean).join(' ')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const model = await buildCreditModel()
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
    console.error('Credit model error:', err)
    res.status(500).json({ error: 'Failed to build credit model' })
  }
}
