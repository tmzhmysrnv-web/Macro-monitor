// pages/api/weekly-digest.ts
// The calm Sunday recap. A daily Vercel cron hits this; it only sends on Sunday
// (ET) and dedups per ISO week, so a double-fire can't double-send. Each weekly
// recipient gets a digest filtered to their own interests. Always sends on
// Sunday — a quiet "nothing changed" week is itself the reassurance.
//
// Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
// ?dry=1 (still authed) builds the shared model + recipient count WITHOUT the
// Sunday gate and WITHOUT sending — for verification.
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCachedDigestBase, digestInterestRows } from '../../lib/weeklyDigest'
import { sendWeeklyDigest } from '../../lib/sendAlert'
import { listAlertRecipients } from '../../lib/recipients'
import { weeklyDigestSent, markWeeklyDigestSent } from '../../lib/redis'
import { INTEREST_CATALOG } from '../../lib/interests'
import { validCronAuth } from '../../lib/http'
import { captureError } from '../../lib/sentry'

const ALL_CATEGORIES = INTEREST_CATALOG.map(c => c.category)

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const dry = req.query.dry === '1'
  const force = req.query.force === '1'
  const forceEmail = typeof req.query.email === 'string' ? req.query.email.trim() : ''

  // Only run on Sunday in ET (the cron fires daily; this is the day gate).
  // dry-run and force test-send bypass it.
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  if (!dry && !force && et.getDay() !== 0) {
    return res.status(200).json({ skipped: 'not Sunday (ET)', etDay: et.getDay() })
  }

  try {
    const base = await getCachedDigestBase()
    if (!base) {
      // Surface a silent miss: nothing got sent because the data couldn't build.
      await captureError(new Error('Weekly digest: data unavailable at build time'), { route: 'weekly-digest' })
      return res.status(200).json({ skipped: 'data unavailable' })
    }

    const recipients = (await listAlertRecipients()).filter(r => r.emailEnabled && r.frequency === 'weekly')

    if (dry) {
      return res.status(200).json({ dry: true, recipients: recipients.length, total: base.total, movers: base.movers.length, events: base.events.length })
    }

    // Authed on-demand test send: one real digest to a given address, bypassing the
    // Sunday gate + per-week dedup. Reports whether that address resolves to a
    // recipient and at what frequency — directly diagnoses "why didn't I get it".
    if (force) {
      if (!forceEmail) return res.status(400).json({ error: 'force=1 requires &email=<address>' })
      const all = await listAlertRecipients()
      const match = all.find(r => r.email.toLowerCase() === forceEmail.toLowerCase())
      const rows = digestInterestRows(match?.interests ?? ALL_CATEGORIES, base.values)
      const ok = await sendWeeklyDigest({ email: forceEmail, token: match?.token ?? 'u:test' }, base, rows)
      return res.status(200).json({
        forced: true, email: forceEmail, sent: ok,
        recipientResolved: !!match,          // false = not email-enabled OR no prefs row
        frequency: match?.frequency ?? null, // 'breaking' here = why no weekly digest
        emailEnabled: match?.emailEnabled ?? null,
      })
    }

    const week = isoWeek(et)
    let sent = 0, skipped = 0
    const results = await Promise.allSettled(recipients.map(async r => {
      if (await weeklyDigestSent(week, r.email)) { skipped++; return }
      const rows = digestInterestRows(r.interests ?? ALL_CATEGORIES, base.values)
      const ok = await sendWeeklyDigest({ email: r.email, token: r.token }, base, rows)
      if (ok) { await markWeeklyDigestSent(week, r.email); sent++ }
    }))
    const failed = results.filter(x => x.status === 'rejected').length

    // Surface silent misses to Sentry: nobody eligible, or sends that errored.
    if (recipients.length === 0) {
      await captureError(new Error('Weekly digest: 0 eligible weekly recipients'), { route: 'weekly-digest', week })
    } else if (failed > 0) {
      await captureError(new Error(`Weekly digest: ${failed}/${recipients.length} sends failed`), { route: 'weekly-digest', week, sent, failed })
    }

    return res.status(200).json({ week, recipients: recipients.length, sent, skipped, failed, at: new Date().toISOString() })
  } catch (err) {
    console.error('Weekly digest error:', err)
    await captureError(err, { route: 'weekly-digest' })
    return res.status(500).json({ error: 'Weekly digest failed' })
  }
}
