// pages/api/confirm.ts
// Confirms a pending subscriber (clicked from the confirmation email).
import type { NextApiRequest, NextApiResponse } from 'next'
import { getSubscriberByToken, upsertSubscriber } from '../../lib/redis'
import { resultPage } from '../../lib/resultPage'
import { collectAlerts } from '../../lib/alertEngine'
import { sendDigest } from '../../lib/sendAlert'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = String(req.query.token || '')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  if (!token) return res.status(400).send(resultPage('Invalid link', 'This confirmation link is missing its token.'))

  try {
    const sub = await getSubscriberByToken(token)
    if (!sub) return res.status(404).send(resultPage('Link expired', "We couldn't find this subscription. Try subscribing again."))

    const firstConfirm = sub.status !== 'active'
    if (firstConfirm) {
      await upsertSubscriber({ ...sub, status: 'active', confirmedAt: new Date().toISOString() })
      // Welcome with the current state of the world: if anything is breaking
      // right now, send this new subscriber that snapshot immediately (the cron
      // only emails on changes, so without this they'd hear nothing until the
      // next new/escalated alert).
      try {
        const { alerts } = await collectAlerts()
        if (alerts.length > 0) await sendDigest(alerts, { email: sub.email, token: sub.token })
      } catch (e) {
        console.error('Confirm welcome digest failed:', e)
      }
    }
    return res.status(200).send(resultPage("You're subscribed ✓", "We'll email you when a macro indicator breaks — and stay quiet otherwise."))
  } catch (err) {
    console.error('Confirm error:', err)
    return res.status(500).send(resultPage('Something went wrong', 'Please try the link again in a moment.'))
  }
}
