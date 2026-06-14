// pages/api/subscribe.ts
// Starts double opt-in: records a pending subscriber and emails a confirm link.
import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID } from 'crypto'
import { getSubscriber, upsertSubscriber, redisReady } from '../../lib/redis'
import { sendConfirmationEmail } from '../../lib/sendAlert'

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

    // Reuse the pending token if one exists so older confirm links keep working.
    const token = existing?.token ?? randomUUID()
    await upsertSubscriber({
      email,
      status: 'pending',
      token,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    })

    await sendConfirmationEmail(email, token)
    return res.status(200).json({ ok: true, status: 'pending', message: 'Check your inbox to confirm.' })
  } catch (err) {
    console.error('Subscribe error:', err)
    return res.status(500).json({ error: 'Something went wrong. Try again.' })
  }
}
