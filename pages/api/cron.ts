// pages/api/cron.ts
// Called by Vercel Cron — checks thresholds and sends alerts
// Protect with CRON_SECRET so only Vercel can call it

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData, MacroData } from '../../lib/fetchData'
import { INDICATORS, getStatus } from '../../lib/thresholds'
import { sendAllAlerts, AlertPayload } from '../../lib/sendAlert'

// Track last alert time in-memory (resets on cold start — good enough for free tier)
// For production, persist this to Supabase or Vercel KV
const lastAlerted: Record<string, number> = {}
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4 hours between repeat alerts

function getValueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper,
  }
  return map[key] ?? null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify secret header (Vercel Cron sends this automatically when configured)
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

      // Respect cooldown — don't spam
      const lastTime = lastAlerted[indicator.key] || 0
      if (now - lastTime < ALERT_COOLDOWN_MS) continue

      lastAlerted[indicator.key] = now

      if (indicator.alertAbove != null && value >= indicator.alertAbove) {
        triggeredAlerts.push({
          indicator: indicator.label,
          value,
          threshold: indicator.alertAbove,
          direction: 'above',
          unit: indicator.unit,
        })
      } else if (indicator.alertBelow != null && value <= indicator.alertBelow) {
        triggeredAlerts.push({
          indicator: indicator.label,
          value,
          threshold: indicator.alertBelow,
          direction: 'below',
          unit: indicator.unit,
        })
      }
    }

    if (triggeredAlerts.length > 0) {
      await sendAllAlerts(triggeredAlerts)
    }

    res.status(200).json({
      checked: INDICATORS.length,
      triggered: triggeredAlerts.length,
      alerts: triggeredAlerts.map(a => a.indicator),
      at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Cron error:', err)
    res.status(500).json({ error: 'Cron failed' })
  }
}
