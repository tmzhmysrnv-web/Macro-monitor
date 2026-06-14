// pages/api/notifications.ts
// Returns the recent in-app notification feed (populated by the daily cron).
import type { NextApiRequest, NextApiResponse } from 'next'
import { getFeed } from '../../lib/redis'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const items = await getFeed()
    // Short cache — the feed only changes when the cron runs.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
    res.status(200).json({ items })
  } catch (err) {
    console.error('Notifications error:', err)
    res.status(200).json({ items: [] })
  }
}
