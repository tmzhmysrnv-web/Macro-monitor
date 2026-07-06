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
//   • cleared then re-fires            → notify, UNLESS it's a "level" family still
//                                         inside the cooldown window (anti-flapping).
//                                         "Event" families (a sharp sell-off, a yield
//                                         spike) skip the cooldown — each occurrence is
//                                         a distinct event worth sending — as does a
//                                         re-fire that returns at a worse rank.
//   • cleared past the cooldown        → tombstone forgotten, so it's "new" again
// Without Redis configured, nothing persists and no email is sent — the run is a
// safe no-op that still reports what it found.

// Re-notify a flapping LEVEL alert at most once per this window.
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000
// Discrete-event families — each fresh occurrence notifies, no cooldown.
const EVENT_FAMILIES = new Set(['market-selloff', 'yield-spike'])

import type { NextApiRequest, NextApiResponse } from 'next'
import { buildAlertReport, type FiredAlert } from '../../lib/alertEngine'
import { alertFamily, alertRank } from '../../lib/alertSeverity'
import { captureError } from '../../lib/sentry'
import {
  getAlertStates, setAlertStates, clearAlertStates, pushFeed, recordBreakMeterTotal,
  type AlertState, type FeedItem,
} from '../../lib/redis'
import { listAlertRecipients, alertsForRecipient } from '../../lib/recipients'
import { sendDigest } from '../../lib/sendAlert'
import { syncEconomicCalendar } from '../../lib/calendarSync'
import { validCronAuth } from '../../lib/http'
import { runWeeklyDigest } from '../../lib/weeklyDigestRunner'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  if (!validCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const report = await buildAlertReport()
    const { alerts, errors } = report
    // Daily Break Meter snapshot — guarantees a week-over-week point even on
    // zero-traffic days (page renders also record one). Never break the run.
    try { if (report.breakLevel != null) await recordBreakMeterTotal(report.breakLevel) } catch (e) { console.error('BM snapshot failed:', e) }
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

    const toNotify: FiredAlert[] = []
    const nextStates: Record<string, AlertState> = {}
    const clearedKeys: string[] = []

    // Firing families: notify on new, escalation, or a (cooled-down) re-fire.
    for (const [fam, { alert, rank }] of famNow) {
      const p = prior[fam]
      const wasFiring = p ? p.firing !== false : false
      let notify: boolean
      if (!p) {
        notify = true                                        // brand new
      } else if (wasFiring) {
        notify = rank > p.severity                           // escalation only; downgrade/same is silent
      } else {
        // re-fire after a clear: event families and worse-than-last always notify;
        // level families wait out the cooldown to absorb flapping.
        const isEvent = EVENT_FAMILIES.has(alertFamily(alert.id))
        const cooled = now - (p.notifiedTs ?? 0) >= COOLDOWN_MS
        notify = isEvent || cooled || rank > p.severity
      }
      if (notify) toNotify.push(alert)
      nextStates[fam] = {
        title: alert.title,
        severity: rank,
        ts: notify ? now : (p?.ts ?? now),
        notifiedTs: notify ? now : (p?.notifiedTs ?? now),
        firing: true,
      }
    }

    // Families no longer firing: keep a tombstone through the cooldown, then forget.
    for (const fam of Object.keys(prior)) {
      if (famNow.has(fam)) continue
      const p = prior[fam]
      if (p.firing !== false) {
        nextStates[fam] = { ...p, firing: false, ts: now }   // just cleared → tombstone
      } else if (now - (p.notifiedTs ?? p.ts) >= COOLDOWN_MS) {
        clearedKeys.push(fam)                                // tombstone expired → forget
      } else {
        nextStates[fam] = p                                  // keep tombstone alive
      }
    }

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
      // Each recipient gets a digest filtered to the topics they follow (accounts);
      // legacy email subscribers follow everything. Skip anyone with no matching alert.
      const recipients = await listAlertRecipients()
      const sends = await Promise.allSettled(
        recipients.map(r => {
          const personalized = alertsForRecipient(toNotify, r)
          if (!r.emailEnabled || personalized.length === 0) return Promise.resolve(false)
          return sendDigest(personalized, { email: r.email, token: r.token }, digestCtx)
        })
      )
      emailed = sends.filter(r => r.status === 'fulfilled' && r.value).length
    }

    // Refresh the economic calendar and weekly digest from this single daily
    // cron. Keeping all scheduled work here avoids relying on a second Vercel
    // cron slot for the Sunday email.
    // Never let a calendar failure break the alert run.
    let calendar: Awaited<ReturnType<typeof syncEconomicCalendar>> | { errors: string[] } = { errors: [] }
    try {
      calendar = await syncEconomicCalendar()
    } catch (e) {
      console.error('Calendar sync failed:', e)
      calendar = { errors: [e instanceof Error ? e.message : String(e)] }
    }

    let weeklyDigest: Awaited<ReturnType<typeof runWeeklyDigest>> | { error: string } = { error: 'not run' }
    try {
      weeklyDigest = await runWeeklyDigest()
    } catch (e) {
      console.error('Weekly digest run failed:', e)
      await captureError(e, { route: 'cron', task: 'weekly-digest' })
      weeklyDigest = { error: e instanceof Error ? e.message : String(e) }
    }

    res.status(200).json({
      firing: alerts.length,
      notified: toNotify.length,
      cleared: clearedKeys.length,
      emailed,
      errors,
      calendar,
      weeklyDigest,
      at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Cron error:', err)
    await captureError(err, { route: 'cron' })
    res.status(500).json({ error: 'Cron failed' })
  }
}
