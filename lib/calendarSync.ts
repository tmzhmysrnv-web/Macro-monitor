// lib/calendarSync.ts
// Daily refresh of the economic_events table (called from /api/cron). Pulls
// official release dates from FRED (CPI/Jobs/GDP/PPI/Claims) + the maintained
// FOMC seed, upserts them, and prunes events older than a week. Robust: a failing
// source never aborts the run, and incomplete rows are skipped (never null-overwrite).
import { getSupabaseAdmin } from './supabase/server'
import { fetchFredReleases, type ScrapedEvent } from './calendarSources/fred'
import { FALLBACK_SEED, EVENT_META, impactDescription, type EventType } from './economicCalendar'

const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
const seedTime = (t: EventType) => (t === 'FOMC' ? 'T14:00:00-05:00' : 'T08:30:00-05:00')

function seedRows(filter?: (t: EventType) => boolean): ScrapedEvent[] {
  return FALLBACK_SEED
    .filter(s => (filter ? filter(s.type) : true))
    .map(s => ({
      event_type: s.type,
      event_name: EVENT_META[s.type].label,
      release_date: `${s.date}${seedTime(s.type)}`,
      source_url: s.type === 'FOMC' ? FOMC_URL : '',
    }))
}

export async function syncEconomicCalendar(): Promise<{ upserted: number; deleted: number; errors: string[] }> {
  const admin = getSupabaseAdmin()
  if (!admin) return { upserted: 0, deleted: 0, errors: ['supabase admin not configured'] }

  const errors: string[] = []
  let rows: ScrapedEvent[] = []

  // FRED is the source for CPI/Jobs/GDP/PPI/Claims.
  try {
    rows = await fetchFredReleases()
  } catch (e) {
    errors.push(`fred: ${e instanceof Error ? e.message : String(e)}`)
  }
  // FOMC always from the maintained seed (not a FRED release).
  rows = rows.concat(seedRows(t => t === 'FOMC'))
  // Safety net: if FRED produced nothing, fall back to the full hardcoded seed so
  // the table is never left empty.
  if (rows.filter(r => r.event_type !== 'FOMC').length === 0) {
    rows = rows.concat(seedRows(t => t !== 'FOMC'))
  }

  // Dedup by (type, release_date); drop incomplete rows (never null-overwrite).
  const map = new Map<string, ScrapedEvent>()
  for (const r of rows) {
    if (!r.release_date || !r.event_name) continue
    map.set(`${r.event_type}|${r.release_date}`, r)
  }
  const upsertRows = [...map.values()].map(r => ({
    event_type: r.event_type,
    event_name: r.event_name,
    release_date: r.release_date,
    impact_level: EVENT_META[r.event_type].impactLevel,
    source_url: r.source_url || null,
    impact_description: impactDescription(r.event_type),
    updated_at: new Date().toISOString(),
  }))

  let upserted = 0
  if (upsertRows.length) {
    const { error } = await admin.from('economic_events').upsert(upsertRows, { onConflict: 'event_type,release_date' })
    if (error) errors.push(`upsert: ${error.message}`)
    else upserted = upsertRows.length
  }

  // Prune events older than a week.
  let deleted = 0
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { error: delErr, count } = await admin.from('economic_events').delete({ count: 'exact' }).lt('release_date', cutoff)
  if (delErr) errors.push(`delete: ${delErr.message}`)
  else deleted = count ?? 0

  return { upserted, deleted, errors }
}
