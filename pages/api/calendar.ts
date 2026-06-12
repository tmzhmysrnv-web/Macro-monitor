// pages/api/calendar.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCalendarEvents } from '../../lib/fetchCalendar'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const events = getCalendarEvents()
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
  res.status(200).json({ events })
}
