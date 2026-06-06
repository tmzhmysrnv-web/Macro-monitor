// pages/api/history.ts
// Returns 20yr historical time series for a single indicator
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllHistory } from '../../lib/fetchHistory'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const { key } = req.query
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key required' })

  try {
    const all = await fetchAllHistory()
    const series = all[key]
    if (!series) return res.status(404).json({ error: 'Unknown indicator' })
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600')
    res.status(200).json({ key, series })
  } catch (err) {
    console.error('History fetch error:', err)
    res.status(500).json({ error: 'Failed to fetch history' })
  }
}
