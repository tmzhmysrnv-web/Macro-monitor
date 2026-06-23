// pages/api/breakmeter.ts
// The Overview's fast early-warning payload: Break Meter score + the derived
// intelligence that answers "is the world breaking?" — active alerts, recent
// breaks, what's nearest to breaking, drivers, and a one-line briefing.
// The payload itself lives in lib/breakMeter.ts so the landing-page bundle
// (lib/bundle.ts) and this endpoint stay byte-for-byte identical.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildBreakMeterPayload } from '../../lib/breakMeter'
import { cacheData } from '../../lib/http'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const payload = await buildBreakMeterPayload()
    cacheData(res, payload.available, 900, 3600)
    res.status(200).json(payload)
  } catch (err) {
    console.error('Break meter error:', err)
    res.status(500).json({ error: 'Failed to compute break meter' })
  }
}
