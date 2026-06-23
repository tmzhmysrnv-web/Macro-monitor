// pages/api/admin/reset.ts
// Testing-only maintenance: wipe subscribers so you can re-test signup with the
// same address. Guarded by CRON_SECRET. Pass ?all=1 to also clear the feed +
// alert dedup state. TEMPORARY — remove once a proper auth/admin layer exists.
import type { NextApiRequest, NextApiResponse } from 'next'
import { resetSubscribers, resetFeedAndAlertState, redisReady } from '../../../lib/redis'
import { validCronAuth } from '../../../lib/http'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!redisReady()) return res.status(503).json({ error: 'Redis not configured' })

  try {
    const removedSubscribers = await resetSubscribers()
    const alsoState = req.query.all === '1' || req.query.all === 'true'
    if (alsoState) await resetFeedAndAlertState()
    return res.status(200).json({ ok: true, removedSubscribers, clearedFeedAndState: alsoState })
  } catch (err) {
    console.error('Admin reset error:', err)
    return res.status(500).json({ error: 'Reset failed' })
  }
}
