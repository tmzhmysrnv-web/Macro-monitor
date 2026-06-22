// lib/economicCalendar.ts
// Single data layer for the economic calendar. Reads the Supabase
// `economic_events` table (the daily cron is the writer) and falls back to a
// built-in schedule so the calendar is never empty / never blocks a render.
//
// Client-safe: this module never imports the service-role client. Callers pass
// the client they have — the browser anon client on the public site, the
// service-role/admin client on the server (cron, bonds, digest).
import type { SupabaseClient } from '@supabase/supabase-js'

export type EventType = 'CPI' | 'JOBS' | 'GDP' | 'FOMC' | 'PPI' | 'RETAIL' | 'CLAIMS' | 'CONFIDENCE' | 'ISM'

// Shape consumed by the UI + helpers (back-compatible with the old fetchCalendar).
export type EconomicEvent = {
  name: string
  date: string                 // YYYY-MM-DD
  daysUntil: number            // negative = past (calendar-day granularity)
  released: boolean            // has the actual release instant passed?
  importance: 'high' | 'medium' | 'low'
  description: string
  eventType: EventType
  sourceUrl?: string
  impactBullets: string[]      // for the "Coming up" banner
  metricKey?: string           // tracked indicator this release prints into
}

type Meta = { label: string; impactLevel: 'high' | 'medium' | 'low'; metricKey?: string; bullets: string[] }

export const EVENT_META: Record<EventType, Meta> = {
  CPI:        { label: 'CPI Report', impactLevel: 'high', metricKey: 'cpi', bullets: ['Inflation expectations', 'Bond yields', 'Mortgage rates', 'Fed policy'] },
  JOBS:       { label: 'Jobs Report', impactLevel: 'high', metricKey: 'payrolls', bullets: ['Labor market health', 'Fed policy', 'Recession risk'] },
  GDP:        { label: 'GDP', impactLevel: 'high', bullets: ['Growth outlook', 'Recession risk', 'Corporate earnings'] },
  FOMC:       { label: 'FOMC Decision', impactLevel: 'high', metricKey: 'fedfunds', bullets: ['Interest rates', 'Bond yields', 'Mortgage rates', 'Stock valuations'] },
  PPI:        { label: 'PPI', impactLevel: 'medium', bullets: ['Pipeline inflation', 'Corporate margins'] },
  RETAIL:     { label: 'Retail Sales', impactLevel: 'medium', bullets: ['Consumer spending', 'Growth outlook'] },
  CLAIMS:     { label: 'Jobless Claims', impactLevel: 'medium', metricKey: 'joblessClaims', bullets: ['Labor market health', 'Recession risk'] },
  CONFIDENCE: { label: 'Consumer Confidence', impactLevel: 'low', bullets: ['Spending outlook'] },
  ISM:        { label: 'ISM PMI', impactLevel: 'medium', bullets: ['Business activity', 'Growth outlook'] },
}

export const impactDescription = (t: EventType): string => EVENT_META[t].bullets.join(', ')

// Release instant: FOMC posts 14:00 ET, everything else ~08:30 ET. We tag the
// fixed-offset to keep day math stable regardless of server timezone.
function releaseInstant(type: EventType, dateStr: string): Date {
  const hhmm = type === 'FOMC' ? 'T14:00:00-05:00' : 'T08:30:00-05:00'
  return new Date(dateStr + hhmm)
}

function derive(type: EventType, dateStr: string): { daysUntil: number; released: boolean } {
  const now = new Date()
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const instant = releaseInstant(type, dateStr)
  // released compares against ET wall-clock so it flips at the true release time.
  const relAtET = new Date(instant.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return {
    daysUntil: Math.ceil((instant.getTime() - now.getTime()) / 86_400_000),
    released: nowET.getTime() >= relAtET.getTime(),
  }
}

function toEvent(type: EventType, dateStr: string, name?: string, description?: string, sourceUrl?: string): EconomicEvent {
  const m = EVENT_META[type]
  const { daysUntil, released } = derive(type, dateStr)
  return {
    name: name ?? m.label,
    date: dateStr,
    daysUntil,
    released,
    importance: m.impactLevel,
    description: description ?? m.label,
    eventType: type,
    sourceUrl,
    impactBullets: m.bullets,
    metricKey: m.metricKey,
  }
}

// ── Built-in fallback (today's hardcoded 2026 schedule) ───────────────
// Used when the table is empty or Supabase is unconfigured, and seeded into the
// table on the first cron run.
type Seed = { type: EventType; date: string; description: string }
export const FALLBACK_SEED: Seed[] = [
  ...['2026-01-14', '2026-02-11', '2026-03-11', '2026-04-10', '2026-05-13', '2026-06-11', '2026-07-14', '2026-08-12', '2026-09-11', '2026-10-14', '2026-11-12', '2026-12-11']
    .map((date, i) => ({ type: 'CPI' as EventType, date, description: `Consumer Price Index — ${['Dec 2025', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'][i]} data` })),
  ...['2026-01-09', '2026-02-06', '2026-03-06', '2026-04-03', '2026-05-08', '2026-06-05', '2026-07-09', '2026-08-07', '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04']
    .map((date) => ({ type: 'JOBS' as EventType, date, description: 'Non-Farm Payrolls' })),
  ...['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']
    .map((date) => ({ type: 'FOMC' as EventType, date, description: 'Federal Reserve interest rate decision' })),
  ...['2026-01-29', '2026-04-29', '2026-07-29', '2026-10-28']
    .map((date) => ({ type: 'GDP' as EventType, date, description: 'GDP advance estimate' })),
]

function fallbackEvents(): EconomicEvent[] {
  return FALLBACK_SEED.map(s => toEvent(s.type, s.date, EVENT_META[s.type].label, s.description))
}

// ── Read from Supabase (with fallback) ────────────────────────────────
type Row = { event_type: string; event_name: string; release_date: string; impact_level?: string; source_url?: string }

function mapRows(rows: Row[]): EconomicEvent[] {
  const out: EconomicEvent[] = []
  for (const r of rows) {
    const type = r.event_type as EventType
    if (!EVENT_META[type]) continue
    const dateStr = new Date(r.release_date).toISOString().slice(0, 10)
    out.push(toEvent(type, dateStr, r.event_name, r.event_name, r.source_url))
  }
  return out
}

// In-process memo so repeated calls in one request wave don't re-query.
let _memo: { at: number; events: EconomicEvent[] } | null = null
const MEMO_MS = 10 * 60 * 1000

export async function fetchEvents(client: SupabaseClient | null): Promise<EconomicEvent[]> {
  if (_memo && Date.now() - _memo.at < MEMO_MS) return _memo.events
  let events = fallbackEvents()
  if (client) {
    try {
      const since = new Date(Date.now() - 21 * 86_400_000).toISOString()
      const { data, error } = await client
        .from('economic_events')
        .select('event_type, event_name, release_date, impact_level, source_url')
        .gte('release_date', since)
        .order('release_date', { ascending: true })
      if (!error && data && data.length) events = mapRows(data as Row[])
    } catch { /* keep fallback */ }
  }
  _memo = { at: Date.now(), events }
  return events
}

// ── Pure derived helpers (operate on a fetched array) ─────────────────
export const recentAndUpcoming = (events: EconomicEvent[]): EconomicEvent[] =>
  events.filter(e => e.daysUntil >= -21 && e.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil)

export const upcoming = (events: EconomicEvent[], maxDays = 30): EconomicEvent[] =>
  events.filter(e => e.daysUntil >= 0 && e.daysUntil <= maxDays).sort((a, b) => a.daysUntil - b.daysUntil)

export function lastFomc(events: EconomicEvent[]): { date: string; daysAgo: number } | null {
  const past = events.filter(e => e.eventType === 'FOMC' && e.released).sort((a, b) => b.date.localeCompare(a.date))
  if (!past.length) return null
  const daysAgo = Math.floor((Date.now() - releaseInstant('FOMC', past[0].date).getTime()) / 86_400_000)
  return { date: past[0].date, daysAgo }
}

export function nextFomc(events: EconomicEvent[]): { date: string; daysUntil: number } | null {
  const fut = events.filter(e => e.eventType === 'FOMC' && !e.released).sort((a, b) => a.date.localeCompare(b.date))
  if (!fut.length) return null
  return { date: fut[0].date, daysUntil: Math.max(0, Math.ceil((releaseInstant('FOMC', fut[0].date).getTime() - Date.now()) / 86_400_000)) }
}
