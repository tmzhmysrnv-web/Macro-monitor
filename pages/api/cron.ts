// pages/api/cron.ts
// Daily alert run. Collects every firing alert across the intelligence tabs,
// figures out which are NEW or ESCALATED since last run, writes those to the
// in-app feed, and emails a single digest to each active subscriber.
//
// Dedup model (Redis hash `alertstate`, keyed `<tab>:<id>`):
//   • new key                          → notify
//   • severity increased               → notify (escalation, e.g. CPI 4% → 5%)
//   • same severity, title changed      → notify (same-id ladder, e.g. sell-off
//                                         "on edge" → "panic" is caught here)
//   • key no longer firing             → cleared, so a future re-fire notifies
// Without Redis configured, nothing persists and no email is sent — the run is a
// safe no-op that still reports what it found.

import type { NextApiRequest, NextApiResponse } from 'next'
import { collectAlerts } from '../../lib/alertEngine'
import {
  getAlertStates, setAlertStates, clearAlertStates, pushFeed,
  listActiveSubscribers, type AlertState, type FeedItem,
} from '../../lib/redis'
import { sendDigest } from '../../lib/sendAlert'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { alerts, errors } = await collectAlerts()
    const prior = await getAlertStates()
    const now = Date.now()

    const firingKeys = new Set(alerts.map(a => a.key))
    const toNotify = alerts.filter(a => {
      const p = prior[a.key]
      if (!p) return true                                   // newly firing
      if (a.severity > p.severity) return true              // escalated
      if (a.severity === p.severity && a.title !== p.title) return true // same-id ladder step
      return false
    })

    // Refresh state for everything firing now. Keep the original timestamp unless
    // this alert is (re)notifying, so `ts` marks when the current tier began.
    const notifyKeys = new Set(toNotify.map(a => a.key))
    const nextStates: Record<string, AlertState> = {}
    for (const a of alerts) {
      const p = prior[a.key]
      nextStates[a.key] = {
        title: a.title,
        severity: a.severity,
        ts: notifyKeys.has(a.key) ? now : (p?.ts ?? now),
      }
    }

    // Alerts that were firing but have now cleared — drop so they can re-notify later.
    const clearedKeys = Object.keys(prior).filter(k => !firingKeys.has(k))

    await Promise.all([
      setAlertStates(nextStates),
      clearAlertStates(clearedKeys),
    ])

    let emailed = 0
    if (toNotify.length > 0) {
      const feedItems: FeedItem[] = toNotify.map(a => ({
        key: a.key, tab: a.tab, tabLabel: a.tabLabel,
        severity: a.severity, title: a.title, what: a.what, ts: now,
      }))
      await pushFeed(feedItems)

      const subscribers = await listActiveSubscribers()
      const sends = await Promise.allSettled(
        subscribers.map(s => sendDigest(toNotify, { email: s.email, token: s.token }))
      )
      emailed = sends.filter(r => r.status === 'fulfilled' && r.value).length
    }

    res.status(200).json({
      firing: alerts.length,
      notified: toNotify.length,
      cleared: clearedKeys.length,
      emailed,
      errors,
      at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Cron error:', err)
    res.status(500).json({ error: 'Cron failed' })
  }
}
