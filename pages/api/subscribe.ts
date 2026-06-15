// pages/api/subscribe.ts
// Single-step signup (no double opt-in): activates the subscriber immediately,
// sends a welcome email, and — if anything is breaking right now — a first alert
// digest so they see the current state of the world.
import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID } from 'crypto'
import { getSubscriber, upsertSubscriber, redisReady } from '../../lib/redis'
import { sendWelcomeEmail, sendDigest } from '../../lib/sendAlert'
import { buildAlertReport } from '../../lib/alertEngine'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!redisReady()) return res.status(503).json({ error: 'Subscriptions are not configured yet.' })

  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' })

  try {
    const existing = await getSubscriber(email)
    if (existing?.status === 'active') {
      return res.status(200).json({ ok: true, status: 'active', message: "You're already subscribed." })
    }

    const now = new Date().toISOString()
    const token = existing?.token ?? randomUUID()
    await upsertSubscriber({
      email,
      status: 'active',
      token,
      createdAt: existing?.createdAt ?? now,
      confirmedAt: now,
    })

    const welcomed = await sendWelcomeEmail(email, token)

    // Send the current active alerts as a first digest (the cron only emails on
    // change, so without this a new subscriber wouldn't see what's already firing).
    try {
      const report = await buildAlertReport()
      if (report.alerts.length > 0) {
        await sendDigest(report.alerts, { email, token }, { breakLevel: report.breakLevel, sections: report.sections })
      }
    } catch (e) {
      console.error('Subscribe first-digest failed:', e)
    }

    return res.status(200).json({
      ok: true,
      status: 'active',
      emailed: welcomed,
      message: welcomed
        ? "You're subscribed. Check your inbox for a welcome note."
        : "You're subscribed — but the welcome email couldn't be sent.",
    })
  } catch (err) {
    console.error('Subscribe error:', err)
    return res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
}
