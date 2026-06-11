// pages/api/summary.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import type { MacroData } from '../../lib/fetchData'
import { fetchAllData } from '../../lib/fetchData'
import { INDICATORS, getStatus, getPercentile } from '../../lib/thresholds'
import { getCalendarContext } from '../../lib/fetchCalendar'

let cachedSummary: { text: string; generatedAt: string } | null = null

function getValueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper,
    mortgage30: data.mortgage30,
  }
  return map[key] ?? null
}

export async function generateSummary(data: MacroData): Promise<string> {
  const snapshot = INDICATORS.map(ind => {
    const value = getValueForKey(data, ind.key)
    if (value == null) return null
    const status = getStatus(ind, value)
    const percentile = getPercentile(ind, value)
    return `${ind.label}: ${value}${ind.unit} (status: ${status}${percentile != null ? `, ${percentile}th historical percentile` : ''})`
  }).filter(Boolean).join('\n')

  const calendarContext = getCalendarContext()

  const prompt = `You are a macro economist writing a daily summary for a personal dashboard called "Is the World Breaking?". Your job is to answer that question honestly every day.

Current indicator snapshot:
${snapshot}

S&P 500 today: ${data.sp500Change != null ? (data.sp500Change > 0 ? '+' : '') + data.sp500Change + '%' : 'unknown'}
Gold: $${data.gold ?? 'unknown'}
Data as of: ${new Date(data.fetchedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

${calendarContext}

Write a 3–5 sentence summary that:
1. Opens with a direct verdict — is the world breaking? (No / Not yet / Getting close / Yes)
2. Identifies the most important signal or combination of signals right now
3. Notes any historically unusual readings (very high or very low percentiles worth flagging)
4. If any major economic releases are coming up in the next 7 days, mention what to watch for and why it matters given current conditions — be specific (e.g. "CPI drops Thursday — given inflation at 3.78% and approaching the 4% alert threshold, a hot print could trigger an alert here")
5. Written in plain English for a financially-aware but non-professional reader

Rules:
- No investment advice or recommendations — describe what the data shows, not what to do
- Be direct and honest — not alarmist, not falsely reassuring
- Flowing prose only, no bullet points
- End with: "This is an automated data summary for informational purposes only. Not financial advice."

Keep it under 120 words total.`

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

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
  return result.content?.[0]?.text ?? 'Summary unavailable.'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    try {
      const data = await fetchAllData()
      const text = await generateSummary(data)
      cachedSummary = { text, generatedAt: new Date().toISOString() }
      return res.status(200).json(cachedSummary)
    } catch (err) {
      console.error('Summary generation error:', err)
      return res.status(500).json({ error: 'Failed to generate summary' })
    }
  }

  if (req.method === 'GET') {
    if (cachedSummary) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json(cachedSummary)
    }
    try {
      const data = await fetchAllData()
      const text = await generateSummary(data)
      cachedSummary = { text, generatedAt: new Date().toISOString() }
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
      return res.status(200).json(cachedSummary)
    } catch (err) {
      console.error('Summary generation error (GET):', err)
      return res.status(200).json({
        text: 'Summary temporarily unavailable.',
        generatedAt: new Date().toISOString(),
      })
    }
  }

  return res.status(405).end()
}
