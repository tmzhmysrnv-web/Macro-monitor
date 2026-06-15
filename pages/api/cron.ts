// pages/api/cron.ts
// Daily alert run. Collects every firing alert across the intelligence tabs,
// figures out which are NEW or ESCALATED since last run, writes those to the
// in-app feed, and emails a single digest to each active subscriber.
//
// Dedup model (Redis hash `alertstate`, keyed by FAMILY `<tab>:<family>`, where a
// family groups a metric's mutually-exclusive tiers — see lib/alertSeverity). The
// stored `severity` field holds the family RANK:
//   • new family                       → notify
//   • rank increased                   → notify (escalation, e.g. CPI 4% → 5%)
//   • rank decreased (downgrade)       → SILENT — an improvement isn't a new break
//   • family no longer firing          → cleared, so a future re-fire notifies
// Without Redis configured, nothing persists and no email is sent — the run is a
// safe no-op that still reports what it found.

import type { NextApiRequest, NextApiResponse } from 'next'
import { buildAlertReport, type FiredAlert } from '../../lib/alertEngine'
import { alertFamily, alertRank } from '../../lib/alertSeverity'
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
    const report = await buildAlertReport()
    const { alerts, errors } = report
    const prior = await getAlertStates()
    const now = Date.now()

    // Collapse firing alerts into families, keeping the highest-rank tier of each
    // (tiers are mutually exclusive, but this is safe if two ever co-fire).
    const famNow = new Map<string, { alert: FiredAlert; rank: number }>()
    for (const a of alerts) {
      const fam = `${a.tab}:${alertFamily(a.id)}`
      const rank = alertRank(a.id, a.severity)
      const cur = famNow.get(fam)
      if (!cur || rank > cur.rank) famNow.set(fam, { alert: a, rank })
    }

    // Notify only on a new family or a rank increase — never a downgrade.
    const toNotify: FiredAlert[] = []
    const nextStates: Record<string, AlertState> = {}
    for (const [fam, { alert, rank }] of famNow) {
      const p = prior[fam]
      const notify = !p || rank > p.severity   // `severity` field stores the family rank
      if (notify) toNotify.push(alert)
      nextStates[fam] = { title: alert.title, severity: rank, ts: notify ? now : (p?.ts ?? now) }
    }

    // Families that were firing but have now cleared — drop so a future re-fire notifies.
    const clearedKeys = Object.keys(prior).filter(k => !famNow.has(k))

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

      const digestCtx = { breakLevel: report.breakLevel, sections: report.sections }
      const subscribers = await listActiveSubscribers()
      const sends = await Promise.allSettled(
        subscribers.map(s => sendDigest(toNotify, { email: s.email, token: s.token }, digestCtx))
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
