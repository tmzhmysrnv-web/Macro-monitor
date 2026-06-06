// pages/api/calendar.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getUpcomingEvents } from '../../lib/fetchCalendar'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const events = getUpcomingEvents()
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
  res.status(200).json({ events })
}
