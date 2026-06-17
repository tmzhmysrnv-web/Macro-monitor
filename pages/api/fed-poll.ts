// pages/api/fed-poll.ts
// Polls the Fed monetary-policy RSS for the latest FOMC statement, parses the
// announced target range, and persists it to Redis (`fed:lastDecision`) so the
// Fed Policy banner can flip the moment the 2pm statement posts — before FRED's
// DFEDTARU catches up the next day.
//
// The per-request backstop in buildBondModel already refreshes this around a
// decision, so a cron is optional; wire one near 2pm ET on FOMC days (a daily
// cron at ~18:15 UTC catches EDT meetings) to warm the store even with no
// visitors. Idempotent and read-only against the Fed; safe to call anytime.
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchFedAnnouncement } from '../../lib/fedAnnouncement'
import { getFedDecision, setFedDecision } from '../../lib/redis'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const fresh = await fetchFedAnnouncement()
    if (!fresh) {
      res.status(200).json({ ok: false, reason: 'no FOMC statement parsed', decision: await getFedDecision() })
      return
    }
    const prior = await getFedDecision()
    const changed = !prior || prior.date !== fresh.date || prior.upper !== fresh.upper
    if (changed) await setFedDecision(fresh)
    res.status(200).json({ ok: true, updated: changed, decision: fresh })
  } catch (err) {
    console.error('fed-poll error:', err)
    res.status(500).json({ error: 'fed-poll failed' })
  }
}
