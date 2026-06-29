// lib/bundle.ts
// The data the public landing page needs ABOVE THE FOLD, in one request:
// raw values + the Break Meter + the calendar. Used by getStaticProps (ISR) to
// server-render the Overview (SEO + instant paint) and by /api/all to refresh it.
//
// NOTE: the seven intelligence tabs are deliberately NOT bundled here. Each tab
// builder fetches its own large, mostly-distinct set of FRED series (inflation
// ~6, credit ~10, …); building them all in one serverless invocation fires ~80
// FRED calls at once and trips the rate limit. They load lazily from their own
// /api/<tab> endpoints instead (each with its own rate budget + CDN cache).
import { fetchAllData } from './fetchData'
import { buildBreakMeterPayload } from './breakMeter'
import { fetchEvents, recentAndUpcoming } from './economicCalendar'
import { getSupabaseAdmin } from './supabase/server'
import { getCached } from './redis'

async function safe<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try { return await fn() } catch (e) { console.error(`bundle: ${label} failed`, e); return null }
}

export async function buildBundle() {
  // Break Meter first: it pulls fetchAllData() + fetchAllHistory(), warming the
  // FRED Data Cache so the raw-data fetch below is served from cache, not refetched.
  const breakmeter = await safe(() => buildBreakMeterPayload(), 'breakmeter')
  const [data, eventsRaw] = await Promise.all([
    safe(() => fetchAllData(), 'data'),
    safe(() => fetchEvents(getSupabaseAdmin()), 'events'),
  ])
  return {
    data: data ?? null,
    breakmeter: breakmeter ?? null,
    events: eventsRaw ? recentAndUpcoming(eventsRaw) : [],
  }
}

export type Bundle = Awaited<ReturnType<typeof buildBundle>>

// Cached entry point used by BOTH the public landing (/api/all) and the signed-in
// dashboard's getServerSideProps. Reading the shared Redis-cached bundle keeps the
// dashboard's TTFB off the ~25-call FRED critical path, and serves last-known-good
// data through FRED rate-limit blips instead of "temporarily unavailable". The
// 900s freshness matches the old /api/all edge TTL.
export function getCachedBundle(): Promise<Bundle> {
  return getCached('bundle', 900, buildBundle, b => !!b.breakmeter?.available)
}
