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
import { getCachedBundle } from './bundle'
import { getCached } from './redis'

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
  // Pull current values from the warm, stale-protected bundle cache (kept fresh by
  // site traffic, falls back to last-known-good) so a Sunday-noon FRED blip can't
  // blank the whole digest. Fall back to a direct fetch if the cache has nothing.
  const bundle = await getCachedBundle()
  const data = (bundle.data ?? (await fetchAllData())) as MacroData
  if (data.vix == null && data.sp500 == null && data.treasury10y == null) return null

  const stress = computeStressIndex(data)
  const total = Math.round(stress.total)

  // History is best-effort: a blip on the historical series shouldn't blank the
  // digest — degrade to "change unknown / no movers" and still send the recap.
  let weekChange: number | null = null
  let changed: Awaited<ReturnType<typeof buildWhatChanged>> = []
  try {
    const history = await fetchAllHistory(1, 'd')
    weekChange = buildMeterChange(history, 7)
    changed = await buildWhatChanged(data, history)
  } catch (e) {
    console.error('weeklyDigest: history unavailable, sending without movers', e)
  }

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

// Cached + stale-protected base: computes once per 30min and serves last-known-good
// for up to ~3 days through a FRED blip. Used by the cron, the dry-run, and the
// force test-send so they share one build and survive transient data gaps.
export function getCachedDigestBase(): Promise<DigestBase | null> {
  return getCached('digest-base', 1800, buildWeeklyDigestBase, b => b != null, 3 * 86400)
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
