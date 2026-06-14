// pages/api/confirm.ts
// Confirms a pending subscriber (clicked from the confirmation email).
import type { NextApiRequest, NextApiResponse } from 'next'
import { getSubscriberByToken, upsertSubscriber } from '../../lib/redis'
import { resultPage } from '../../lib/resultPage'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = String(req.query.token || '')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')

  if (!token) return res.status(400).send(resultPage('Invalid link', 'This confirmation link is missing its token.'))

  try {
    const sub = await getSubscriberByToken(token)
    if (!sub) return res.status(404).send(resultPage('Link expired', "We couldn't find this subscription. Try subscribing again."))

    if (sub.status !== 'active') {
      await upsertSubscriber({ ...sub, status: 'active', confirmedAt: new Date().toISOString() })
    }
    return res.status(200).send(resultPage("You're subscribed ✓", "We'll email you when a macro indicator breaks — and stay quiet otherwise."))
  } catch (err) {
    console.error('Confirm error:', err)
    return res.status(500).send(resultPage('Something went wrong', 'Please try the link again in a moment.'))
  }
}
