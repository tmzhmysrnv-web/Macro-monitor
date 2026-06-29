// pages/api/data.ts
// Returns live macro data as JSON

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData } from '../../lib/fetchData'
import { cacheData } from '../../lib/http'
import { getCached } from '../../lib/redis'
import { captureError } from '../../lib/sentry'

// "Available" = a healthy number of fields actually came back (a FRED/Yahoo
// rate-limit blip returns mostly nulls); don't cache a sparse response.
const liveCount = (d: Awaited<ReturnType<typeof fetchAllData>>) =>
  Object.entries(d).filter(([k, v]) => k !== 'fetchedAt' && v != null).length

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const data = await getCached('data', 900, fetchAllData, d => liveCount(d) >= 8)
    cacheData(res, liveCount(data) >= 8, 900, 1800)
    res.status(200).json(data)
  } catch (err) {
    console.error('Data fetch error:', err)
    await captureError(err, { route: 'data' })
    res.status(500).json({ error: 'Failed to fetch data' })
  }
}
