// lib/calendarSources/fred.ts
// Official release dates via the FRED releases API (St. Louis Fed re-publishes
// the BLS/BEA release calendar as keyed JSON). We use this instead of scraping
// bls.gov / bea.gov directly — those block server-side bots (Akamai). FOMC is
// not a FRED "release", so it comes from the maintained seed in the sync engine.
import { EVENT_META, type EventType } from '../economicCalendar'

export type ScrapedEvent = { event_type: EventType; event_name: string; release_date: string; source_url: string }

// FRED release ids → our event types. release time ~08:30 ET for these.
const RELEASES: { type: EventType; id: number }[] = [
  { type: 'CPI', id: 10 },      // Consumer Price Index
  { type: 'JOBS', id: 50 },     // Employment Situation
  { type: 'GDP', id: 53 },      // Gross Domestic Product
  { type: 'PPI', id: 46 },      // Producer Price Index
  { type: 'CLAIMS', id: 180 },  // Unemployment Insurance Weekly Claims
]

const FRED = 'https://api.stlouisfed.org/fred/release/dates'
const HORIZON_DAYS = 120

async function datesFor(id: number, key: string): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10)
  const url = `${FRED}?release_id=${id}&api_key=${key}&file_type=json&include_release_dates_with_no_data=true&realtime_start=${today}&sort_order=asc&limit=60`
  const res = await fetch(url, { next: { revalidate: 21600 } }) // 6h
  if (!res.ok) return []
  const data = await res.json()
  return (data.release_dates || []).map((d: { date: string }) => d.date).filter(Boolean)
}

export async function fetchFredReleases(): Promise<ScrapedEvent[]> {
  const key = process.env.FRED_API_KEY
  if (!key) return []
  const cutoff = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10)
  const out: ScrapedEvent[] = []
  for (const r of RELEASES) {
    try {
      const dates = await datesFor(r.id, key)
      const url = `https://fred.stlouisfed.org/release?rid=${r.id}`
      for (const date of dates) {
        if (date > cutoff) continue
        out.push({
          event_type: r.type,
          event_name: EVENT_META[r.type].label,
          release_date: `${date}T08:30:00-05:00`,
          source_url: url,
        })
      }
    } catch (e) {
      console.error(`FRED release ${r.id} (${r.type}) failed:`, e)
    }
  }
  return out
}
