// pages/api/all.ts
// One endpoint that returns the whole landing-page bundle (raw data + Break
// Meter + all seven tabs + calendar) in a single request. Replaces the public
// page's old ~9-endpoint client fan-out; also used to refresh the ISR-seeded
// data after first paint.
import type { NextApiRequest, NextApiResponse } from 'next'
import { buildBundle } from '../../lib/bundle'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  try {
    const bundle = await buildBundle()
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600')
    res.status(200).json(bundle)
  } catch (err) {
    console.error('Bundle error:', err)
    res.status(500).json({ error: 'Failed to build bundle' })
  }
}
