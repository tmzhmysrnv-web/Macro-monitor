// pages/api/alerts.ts
// Active alerts for the signed-in app's Alerts page — the same rich FiredAlerts
// the daily cron/email use (title + what/why/affected/context), exposed read-only.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildAlertReport } from '../../lib/alertEngine'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const report = await buildAlertReport()
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
    res.status(200).json({ alerts: report.alerts, breakLevel: report.breakLevel })
  } catch (err) {
    console.error('Alerts API error:', err)
    res.status(200).json({ alerts: [], breakLevel: null })
  }
}
