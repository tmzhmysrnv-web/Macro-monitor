// pages/api/weekly-digest.ts
// Independent weekly digest endpoint. Vercel invokes it daily; the runner sends
// only on Sunday ET and deduplicates each recipient by ISO week.
//
// Auth: Vercel Cron/manual calls send `Authorization: Bearer <CRON_SECRET>`.
// ?dry=1 builds the shared model + recipient count without sending.
// ?force=1&email=<address> sends one diagnostic digest to that address.
// ?runs=1 returns recent durable run receipts without recipient identities.
import type { NextApiRequest, NextApiResponse } from 'next'
import { validCronAuth } from '../../lib/http'
import { captureError } from '../../lib/sentry'
import { runWeeklyDigest } from '../../lib/weeklyDigestRunner'
import { getWeeklyDigestRuns } from '../../lib/redis'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const dry = req.query.dry === '1'
  const force = req.query.force === '1'
  const runs = req.query.runs === '1'
  const forceEmail = typeof req.query.email === 'string' ? req.query.email.trim() : ''

  try {
    if (runs) return res.status(200).json({ runs: await getWeeklyDigestRuns() })
    if (force) {
      if (!forceEmail) return res.status(400).json({ error: 'force=1 requires &email=<address>' })
    }
    return res.status(200).json(await runWeeklyDigest({ dry, forceEmail: force ? forceEmail : undefined }))
  } catch (err) {
    console.error('Weekly digest error:', err)
    await captureError(err, { route: 'weekly-digest' })
    return res.status(500).json({ error: 'Weekly digest failed' })
  }
}
