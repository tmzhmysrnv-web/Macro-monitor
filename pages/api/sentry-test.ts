// pages/api/sentry-test.ts
// TEMPORARY diagnostic — verifies Sentry error reporting end-to-end. Fires a
// deliberately-labeled test exception through captureError (the same server path
// FRED/cron failures use) and reports whether a DSN is configured at runtime
// (boolean only — never echoes the DSN). Rate-limited to avoid quota abuse.
// REMOVE once the integration is confirmed.
import type { NextApiRequest, NextApiResponse } from 'next'
import { captureError } from '../../lib/sentry'
import { rateLimit } from '../../lib/redis'
import { clientIp } from '../../lib/http'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { ok } = await rateLimit(`sentrytest:${clientIp(req)}`, 5, 60)
  if (!ok) return res.status(429).json({ error: 'rate limited' })

  const dsnSet = !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)
  await captureError(new Error(`Sentry server test — ${new Date().toISOString()}`), {
    source: 'sentry-test',
    deliberate: true,
  })
  res.status(200).json({ ok: true, dsnSet, note: 'check Sentry → Issues for "Sentry server test"' })
}
