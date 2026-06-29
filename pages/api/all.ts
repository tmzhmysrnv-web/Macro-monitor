// pages/api/all.ts
// One endpoint that returns the whole landing-page bundle (raw data + Break
// Meter + all seven tabs + calendar) in a single request. Replaces the public
// page's old ~9-endpoint client fan-out; also used to refresh the ISR-seeded
// data after first paint.
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCachedBundle } from '../../lib/bundle'
import { cacheData } from '../../lib/http'
import { captureError } from '../../lib/sentry'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const bundle = await getCachedBundle()
    // Only edge-cache when the Break Meter (the above-the-fold payload the landing
    // page reads) actually came back available; a rate-limited bundle must not be
    // cached or it pins the Overview to "temporarily unavailable" for the whole TTL.
    cacheData(res, !!bundle.breakmeter?.available, 900, 3600)
    res.status(200).json(bundle)
  } catch (err) {
    console.error('Bundle error:', err)
    await captureError(err, { route: 'all' })
    res.status(500).json({ error: 'Failed to build bundle' })
  }
}
