// pages/api/bonds.ts
// Returns the bond-market model: overall status, four-theme scorecard,
// a deterministic plain-English briefing, alerts, and watching-closely.
// No external AI — the briefing is assembled from the computed statuses.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildBondModel, type BondModel } from '../../lib/bonds'

// Deterministic briefing composed from the four theme statuses + risk callout.
function buildSummary(m: BondModel): string {
  if (!m.available) return 'Live bond-market data is temporarily unavailable. Check back shortly.'
  const by: Record<string, string> = Object.fromEntries(m.categories.map(c => [c.key, c.status]))
  const stress = (by.stress || '').replace(/ Markets$/, '').toLowerCase() || 'orderly'
  const themes = `Growth expectations read ${(by.growth || '').toLowerCase()}, financing conditions are ${(by.rates || '').toLowerCase()}, and government financing shows ${(by.financing || '').toLowerCase()} — with Treasury markets ${stress}.`
  return [themes, m.risk.text].filter(Boolean).join(' ')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const model = await buildBondModel()
    // Short edge cache so a fresh FOMC decision (the 2pm statement override)
    // surfaces within minutes rather than the prior hour-long window.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
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
      fedPolicy: model.fedPolicy,
      fedWatch: model.fedWatch,
      rateExpectation: model.rateExpectation,   // internal proxy — present in payload, not rendered
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Bond model error:', err)
    res.status(500).json({ error: 'Failed to build bond model' })
  }
}
