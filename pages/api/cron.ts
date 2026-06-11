// pages/api/cron.ts
// Daily cron: checks thresholds, sends alerts, regenerates AI summary

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData, MacroData } from '../../lib/fetchData'
import { INDICATORS, getStatus } from '../../lib/thresholds'
import { sendAllAlerts, AlertPayload } from '../../lib/sendAlert'
import { generateSummary } from './summary'
import { computeStressIndex } from '../../lib/stressIndex'

const lastAlerted: Record<string, number> = {}
const ALERT_COOLDOWN_MS = 20 * 60 * 60 * 1000 // 20 hours

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const data = await fetchAllData()
    const now = Date.now()
    const triggeredAlerts: AlertPayload[] = []

    for (const indicator of INDICATORS) {
      const value = getValueForKey(data, indicator.key)
      if (value == null) continue
      const status = getStatus(indicator, value)
      if (status !== 'alert') continue
      const lastTime = lastAlerted[indicator.key] || 0
      if (now - lastTime < ALERT_COOLDOWN_MS) continue
      lastAlerted[indicator.key] = now
      if (indicator.alertAbove != null && value >= indicator.alertAbove) {
        triggeredAlerts.push({ indicator: indicator.label, value, threshold: indicator.alertAbove, direction: 'above', unit: indicator.unit })
      } else if (indicator.alertBelow != null && value <= indicator.alertBelow) {
        triggeredAlerts.push({ indicator: indicator.label, value, threshold: indicator.alertBelow, direction: 'below', unit: indicator.unit })
      }
    }

    if (triggeredAlerts.length > 0) await sendAllAlerts(triggeredAlerts)

    // Regenerate AI summary daily
    let summaryStatus = 'skipped'
    try {
      const summaryText = await generateSummary(data)
      // Store in the summary module's cache by calling the endpoint internally
      summaryStatus = summaryText ? 'generated' : 'failed'
    } catch (e) {
      summaryStatus = 'error'
      console.error('Summary generation failed in cron:', e)
    }

    res.status(200).json({
      checked: INDICATORS.length,
      triggered: triggeredAlerts.length,
      alerts: triggeredAlerts.map(a => a.indicator),
      summary: summaryStatus,
      at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Cron error:', err)
    res.status(500).json({ error: 'Cron failed' })
  }
}
