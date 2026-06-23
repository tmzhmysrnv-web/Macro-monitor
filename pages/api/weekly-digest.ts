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
import { buildWeeklyDigestBase, digestInterestRows } from '../../lib/weeklyDigest'
import { sendWeeklyDigest } from '../../lib/sendAlert'
import { listAlertRecipients } from '../../lib/recipients'
import { weeklyDigestSent, markWeeklyDigestSent } from '../../lib/redis'
import { INTEREST_CATALOG } from '../../lib/interests'
import { validCronAuth } from '../../lib/http'

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

  // Only run on Sunday in ET (the cron fires daily; this is the day gate).
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  if (!dry && et.getDay() !== 0) {
    return res.status(200).json({ skipped: 'not Sunday (ET)', etDay: et.getDay() })
  }

  try {
    const base = await buildWeeklyDigestBase()
    if (!base) return res.status(200).json({ skipped: 'data unavailable' })

    const recipients = (await listAlertRecipients()).filter(r => r.emailEnabled && r.frequency === 'weekly')
    if (dry) {
      return res.status(200).json({ dry: true, recipients: recipients.length, total: base.total, movers: base.movers.length, events: base.events.length })
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

    return res.status(200).json({ week, recipients: recipients.length, sent, skipped, failed, at: new Date().toISOString() })
  } catch (err) {
    console.error('Weekly digest error:', err)
    return res.status(500).json({ error: 'Weekly digest failed' })
  }
}
