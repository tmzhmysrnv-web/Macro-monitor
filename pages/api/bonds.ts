// pages/api/bonds.ts
// Returns the bond-market model: overall status, four-theme scorecard,
// plain-English briefing, alerts, and watching-closely thresholds.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildBondModel, type BondModel } from '../../lib/bonds'

let cachedSummary: { text: string; at: number } | null = null
const SUMMARY_TTL = 60 * 60 * 1000 // 1h

// Deterministic fallback when no ANTHROPIC_API_KEY or the API call fails.
function fallbackSummary(m: BondModel): string {
  if (!m.available) return 'Live bond-market data is temporarily unavailable. Check back shortly.'
  const drivers = m.categories.map(c => `${c.label.toLowerCase()} ${c.status.toLowerCase()}`).join(', ')
  return `Bond markets are signalling ${m.status.label.toLowerCase()}. Across the four themes: ${drivers}. ${m.risk}`.trim()
}

async function generateBondSummary(m: BondModel): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const snapshot = m.categories
    .map(c => `${c.label}: ${c.status}\n  ${c.signals.join('\n  ')}`)
    .join('\n')
  const alertText = m.alerts.length
    ? m.alerts.map(a => `- ${a.title}: ${a.what}`).join('\n')
    : 'None currently firing.'

  const prompt = `You are writing the bond-market briefing for a macro dashboard. The page answers one question: "What are bond investors telling us about the economy?"

Overall bond status: "${m.status.label}".

Four-theme snapshot:
${snapshot}

Active alerts:
${alertText}

Write a concise intelligence briefing of 75–125 words. Lead with the dominant message bond investors are sending, then cover growth expectations, how restrictive financing conditions are, and government financing pressure, ending with overall market demand/stress. Be direct and honest — not alarmist, not falsely reassuring. Plain English, flowing prose, no bullet points, no headers, no preamble.

IMPORTANT: Stay in the bond lane. Describe how bond investors are REACTING (e.g. "higher-for-longer", "growth slowing", "fiscal pressure", "risk repricing"). Do NOT make this about inflation or credit narratives — those belong to other sections. No investment advice.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 350,
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
    const model = await buildBondModel()

    let summary: string
    if (!model.available) {
      summary = fallbackSummary(model)
    } else if (cachedSummary && Date.now() - cachedSummary.at < SUMMARY_TTL) {
      summary = cachedSummary.text
    } else {
      try {
        summary = await generateBondSummary(model)
        cachedSummary = { text: summary, at: Date.now() }
      } catch (err) {
        console.error('Bond summary generation error:', err)
        summary = fallbackSummary(model)
      }
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      available: model.available,
      status: model.status,
      subtitle: model.subtitle,
      summary,
      risk: model.risk,
      stabilizer: model.stabilizer,
      categories: model.categories,
      alerts: model.alerts,
      lastAlert: model.lastAlert,
      watching: model.watching,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Bond model error:', err)
    res.status(500).json({ error: 'Failed to build bond model' })
  }
}
