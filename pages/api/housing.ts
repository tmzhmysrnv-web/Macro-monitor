// pages/api/housing.ts
// Returns the full housing model: headline status, category drivers,
// plain-English summary, alerts, and watching-closely items.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildHousingModel, type HousingModel } from '../../lib/housing'

let cachedSummary: { text: string; at: number } | null = null
const SUMMARY_TTL = 60 * 60 * 1000 // 1h

// Deterministic fallback summary assembled from the computed statuses —
// used when no ANTHROPIC_API_KEY is set or the API call fails.
function fallbackSummary(m: HousingModel): string {
  const by = Object.fromEntries(m.categories.map(c => [c.key, c]))
  const lead = `Housing is in a "${m.status.label}" state.`
  const aff = by.affordability.signals[0] ? ` ${by.affordability.signals[0]}.` : ''
  const dem = by.demand.signals[0] ? ` ${by.demand.signals[0]}.` : ''
  const sup = by.supply.signals[0] ? ` ${by.supply.signals[0]}.` : ''
  const risk = m.watching[0] ? ` Closest trigger: ${m.watching[0].label.toLowerCase()} — ${m.watching[0].text}.` : ''
  return `${lead}${aff}${dem}${sup}${risk}`
}

async function generateHousingSummary(m: HousingModel): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const snapshot = m.categories
    .map(c => `${c.label}: ${c.status}\n  ${c.signals.join('\n  ')}`)
    .join('\n')
  const alertText = m.alerts.length
    ? m.alerts.map(a => `- ${a.title}: ${a.what}`).join('\n')
    : 'None currently firing.'
  const watchText = m.watching.slice(0, 3).map(w => `- ${w.label}: ${w.text}`).join('\n')

  const prompt = `You are writing the housing-market summary for a macro dashboard. Overall status: "${m.status.label}".

Category snapshot:
${snapshot}

Active alerts:
${alertText}

Approaching thresholds:
${watchText}

Write a 100-150 word plain-English summary that explains: what changed recently, why it matters, the key risks, and the key stabilizers. Be direct and honest — not alarmist, not falsely reassuring. Flowing prose only, no bullet points, no headers. No investment advice. Do not repeat the status label verbatim more than once.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 300)}`)
  }
  const result = await response.json()
  return result.content?.[0]?.text ?? fallbackSummary(m)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const model = await buildHousingModel()

    let summary: string
    if (cachedSummary && Date.now() - cachedSummary.at < SUMMARY_TTL) {
      summary = cachedSummary.text
    } else {
      try {
        summary = await generateHousingSummary(model)
        cachedSummary = { text: summary, at: Date.now() }
      } catch (err) {
        console.error('Housing summary generation error:', err)
        summary = fallbackSummary(model)
      }
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      status: model.status,
      summary,
      categories: model.categories,
      alerts: model.alerts,
      watching: model.watching,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Housing model error:', err)
    res.status(500).json({ error: 'Failed to build housing model' })
  }
}
