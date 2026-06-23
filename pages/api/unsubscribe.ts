// pages/api/unsubscribe.ts
// One-click unsubscribe (linked from every digest email).
// POST performs the unsubscribe — used by RFC 8058 List-Unsubscribe-Post
// one-click (Gmail/Apple) and by the confirm button below. GET only shows a
// confirmation page, so email security scanners that pre-fetch the link can't
// unsubscribe anyone by accident.
import type { NextApiRequest, NextApiResponse } from 'next'
import { getSubscriberByToken, upsertSubscriber } from '../../lib/redis'
import { getSupabaseAdmin } from '../../lib/supabase/server'
import { resultPage, confirmPage } from '../../lib/resultPage'

async function performUnsubscribe(token: string, res: NextApiResponse) {
  // Account recipients carry a `u:<userId>` token → just flip off email alerts.
  if (token.startsWith('u:')) {
    const admin = getSupabaseAdmin()
    if (!admin) return res.status(503).send(resultPage('Something went wrong', 'Please try again in a moment.'))
    try {
      await admin.from('user_preferences').update({ email_enabled: false, updated_at: new Date().toISOString() }).eq('user_id', token.slice(2))
      return res.status(200).send(resultPage('Unsubscribed', "You won't receive any more email alerts. You can turn them back on anytime in Settings."))
    } catch (err) {
      console.error('Unsubscribe (account) error:', err)
      return res.status(500).send(resultPage('Something went wrong', 'Please try the link again in a moment.'))
    }
  }

  try {
    const sub = await getSubscriberByToken(token)
    if (!sub) return res.status(404).send(resultPage('Already gone', "We couldn't find this subscription — you're not on the list."))
    if (sub.status !== 'unsubscribed') await upsertSubscriber({ ...sub, status: 'unsubscribed' })
    return res.status(200).send(resultPage('Unsubscribed', "You won't receive any more macro alerts. You can re-subscribe anytime from the dashboard."))
  } catch (err) {
    console.error('Unsubscribe error:', err)
    return res.status(500).send(resultPage('Something went wrong', 'Please try the link again in a moment.'))
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const token = String(req.query.token || '')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (!token) return res.status(400).send(resultPage('Invalid link', 'This unsubscribe link is missing its token.'))

  if (req.method === 'POST') return performUnsubscribe(token, res)

  return res.status(200).send(confirmPage(
    'Unsubscribe?',
    'Click below to stop receiving these emails. You can re-subscribe anytime.',
    `/api/unsubscribe?token=${encodeURIComponent(token)}`,
    'Unsubscribe',
  ))
}
