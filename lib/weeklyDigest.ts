// lib/weeklyDigest.ts
// Assembles the weekly digest model from data we already compute elsewhere — the
// Break Meter score + weekly change, the biggest movers, upcoming events, and the
// calm bottom line. The macro parts are shared across all recipients (computed
// once); each recipient's watchlist rows are filtered to their own interests.
import { fetchAllData, type MacroData } from './fetchData'
import { fetchAllHistory } from './fetchHistory'
import { computeStressIndex } from './stressIndex'
import { buildWhatChanged } from './whatChanged'
import { buildMeterChange } from './overview'
import { fetchEvents, upcoming } from './economicCalendar'
import { getSupabaseAdmin } from './supabase/server'
import { toneFor, headlineFor, bottomLine, changeLine, type Tone, type ChangeLine } from './statusLadder'
import { INTEREST_CATALOG, readInterest, type InterestCategory } from './interests'

export type DigestMover = { label: string; pct: number; dir: 'better' | 'worse' | 'neutral' }
export type DigestEvent = { name: string; weekday: string }
export type DigestInterestRow = { label: string; status: 'ok' | 'warn' | 'alert'; badge: string; insight: string }

export type DigestBase = {
  total: number
  tone: Tone
  headline: string
  change: ChangeLine
  bottom: { h: string; text: string }
  movers: DigestMover[]
  events: DigestEvent[]
  values: Record<string, number | null>
}

function weekdayOf(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })
}

// Computed once per run and shared across recipients. Returns null when live data
// is too sparse to report (don't fabricate a status).
export async function buildWeeklyDigestBase(): Promise<DigestBase | null> {
  const data = await fetchAllData()
  if (data.vix == null && data.sp500 == null && data.treasury10y == null) return null

  const stress = computeStressIndex(data)
  const total = Math.round(stress.total)
  const history = await fetchAllHistory(1, 'd')
  const weekChange = buildMeterChange(history, 7)
  const changed = await buildWhatChanged(data, history)

  const movers: DigestMover[] = changed.slice(0, 3).map(r => ({
    label: r.label,
    pct: r.weekAgo ? parseFloat((((r.current - r.weekAgo) / Math.abs(r.weekAgo)) * 100).toFixed(1)) : 0,
    dir: r.direction === 'toward-danger' ? 'worse' : r.direction === 'toward-safety' ? 'better' : 'neutral',
  }))

  const calEvents = await fetchEvents(getSupabaseAdmin())
  const events: DigestEvent[] = upcoming(calEvents, 7)
    .filter(e => !e.released)
    .slice(0, 3)
    .map(e => ({ name: e.name, weekday: weekdayOf(e.date) }))

  const bl = bottomLine(total)
  return {
    total,
    tone: toneFor(total),
    headline: headlineFor(total),
    change: changeLine(weekChange),
    bottom: { h: bl.h, text: `${bl.lead}${bl.swap}${bl.tail}` },
    movers,
    events,
    values: data as unknown as Record<string, number | null>,
  }
}

// Per-recipient watchlist rows, in catalog order, for the categories they follow.
export function digestInterestRows(interests: string[], values: Record<string, number | null>): DigestInterestRow[] {
  const follows = new Set(interests as InterestCategory[])
  return INTEREST_CATALOG
    .filter(def => follows.has(def.category))
    .map(def => {
      const r = readInterest(def, values)
      return { label: def.label, status: r.status, badge: r.badge, insight: r.insight }
    })
}

export type { MacroData }
