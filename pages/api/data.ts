// pages/api/data.ts
// Returns live macro data as JSON

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData } from '../../lib/fetchData'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const data = await fetchAllData()
    // Cache for 15 minutes on CDN, allow stale for 30 min
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800')
    res.status(200).json(data)
  } catch (err) {
    console.error('Data fetch error:', err)
    res.status(500).json({ error: 'Failed to fetch data' })
  }
}
