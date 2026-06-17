// pages/api/calendar.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { getCalendarEvents } from '../../lib/fetchCalendar'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const events = getCalendarEvents()
  // Short edge cache so an event flips to "released" within minutes of its
  // actual time (e.g. a 2pm FOMC decision), not up to an hour later.
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600')
  res.status(200).json({ events })
}
