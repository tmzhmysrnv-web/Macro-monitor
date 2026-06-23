// pages/api/data.ts
// Returns live macro data as JSON

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData } from '../../lib/fetchData'
import { cacheData } from '../../lib/http'
import { captureError } from '../../lib/sentry'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const data = await fetchAllData()
    // "Available" = a healthy number of fields actually came back (a FRED/Yahoo
    // rate-limit blip returns mostly nulls); don't edge-cache a sparse response.
    const liveCount = Object.entries(data).filter(([k, v]) => k !== 'fetchedAt' && v != null).length
    cacheData(res, liveCount >= 8, 900, 1800)
    res.status(200).json(data)
  } catch (err) {
    console.error('Data fetch error:', err)
    await captureError(err, { route: 'data' })
    res.status(500).json({ error: 'Failed to fetch data' })
  }
}
