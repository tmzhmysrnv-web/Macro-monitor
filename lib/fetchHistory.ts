// lib/fetchHistory.ts
// Fetches multi-year historical time series from FRED + Yahoo Finance
// Used for the interactive chart on each card

import { fredFetch } from './fred'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

export type DataPoint = { date: string; value: number }

type Freq = 'd' | 'm'
type HistoryFetcher = (years?: number, freq?: Freq) => Promise<DataPoint[]>

async function fetchFredHistory(seriesId: string, years = 10, freq: Freq = 'd'): Promise<DataPoint[]> {
  try {
    const start = new Date()
    start.setFullYear(start.getFullYear() - years)
    const startStr = start.toISOString().split('T')[0]
    // limit=100000 (FRED max): daily series have ~5200 obs over 20yrs; the
    // previous limit=1000 with asc sort truncated them to the oldest ~4 years.
    // freq='m' asks FRED to aggregate to end-of-month — ~12x smaller payloads
    // for the long-range Break Meter trend, which only needs monthly points.
    const monthly = freq === 'm' ? '&frequency=m&aggregation_method=eop' : ''
    const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=asc&observation_start=${startStr}&limit=100000${monthly}`
    const parse = (data: { observations?: { value: string; date: string }[] }): DataPoint[] =>
      (data.observations || [])
        .filter(o => o.value !== '.' && o.value !== '')
        .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    const res = await fredFetch(url, { next: { revalidate: 86400 } }) // cache 24h
    if (!res || !res.ok) return []
    const out = parse(await res.json())
    if (out.length) return out
    // Cached read succeeded but came back empty. A transient empty response from
    // FRED would otherwise be served from the 24h cache for a full day (this is
    // what blanked out MORTGAGE30US history). Bypass the cache once so an empty
    // never sticks; if it's still empty, FRED genuinely has nothing right now.
    const fresh = await fredFetch(url, { cache: 'no-store' })
    if (fresh && fresh.ok) return parse(await fresh.json())
    return []
  } catch { return [] }
}

async function fetchYahooHistory(symbol: string, years = 10, freq: Freq = 'd'): Promise<DataPoint[]> {
  try {
    const range = `${years}y`
    const interval = freq === 'm' ? '1mo' : '1wk'
    const encoded = encodeURIComponent(symbol)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=${interval}&range=${range}`
    type YahooChart = { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } }
    const parse = (data: YahooChart): DataPoint[] => {
      const result = data?.chart?.result?.[0]
      const timestamps = result?.timestamp || []
      const closes = result?.indicators?.quote?.[0]?.close || []
      return timestamps
        .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().split('T')[0], value: closes[i] }))
        .filter((d): d is DataPoint => d.value != null && !isNaN(d.value))
    }
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) return []
    const out = parse(await res.json())
    if (out.length) return out
    // Same self-heal as fetchFredHistory: a transient empty response would
    // otherwise be served from the 24h cache for a full day. Bypass the cache
    // once so an empty never sticks (covers VIX, equities, commodities, dollar).
    const fresh = await fetch(url, { cache: 'no-store' })
    if (fresh.ok) return parse(await fresh.json())
    return []
  } catch { return [] }
}

async function fetchFredYoYHistory(seriesId: string, years = 10, freq: Freq = 'd'): Promise<DataPoint[]> {
  // Fetch extra year so we can compute YoY. CSUSHPINSA/CPIAUCSL are monthly
  // series, so raw[i-12] is 12 months back in either freq mode.
  const raw = await fetchFredHistory(seriesId, years + 1, freq)
  if (raw.length < 13) return raw
  // Compute YoY % change
  return raw.slice(12).map((point, i) => ({
    date: point.date,
    value: parseFloat(((point.value - raw[i].value) / raw[i].value * 100).toFixed(2)),
  }))
}

async function fetchJoblessHistory(years = 10, freq: Freq = 'd'): Promise<DataPoint[]> {
  const raw = await fetchFredHistory('ICSA', years, freq)
  return raw.map(d => ({ date: d.date, value: parseFloat((d.value / 1000).toFixed(1)) }))
}

// Non-farm payrolls as the monthly job change (thousands) — PAYEMS is the level,
// diff it month-over-month so the card charts the metric people actually watch.
async function fetchPayrollsHistory(years = 10, freq: Freq = 'd'): Promise<DataPoint[]> {
  const raw = await fetchFredHistory('PAYEMS', years + 1, freq)
  const out: DataPoint[] = []
  for (let i = 1; i < raw.length; i++) out.push({ date: raw[i].date, value: Math.round(raw[i].value - raw[i - 1].value) })
  return out
}

async function fetchYieldCurveHistory(years = 10, freq: Freq = 'd'): Promise<DataPoint[]> {
  const [t10, t2] = await Promise.all([
    fetchFredHistory('DGS10', years, freq),
    fetchFredHistory('DGS2', years, freq),
  ])
  // Align by date
  const t2Map = new Map(t2.map(d => [d.date, d.value]))
  return t10
    .filter(d => t2Map.has(d.date))
    .map(d => ({ date: d.date, value: parseFloat((d.value - t2Map.get(d.date)!).toFixed(2)) }))
}

export type HistoryMap = Record<string, DataPoint[]>

export const HISTORY_FETCHERS: Record<string, HistoryFetcher> = {
  vix: (years, freq) => fetchYahooHistory('^VIX', years, freq),
  treasury10y: (years, freq) => fetchFredHistory('DGS10', years, freq),
  treasury2y: (years, freq) => fetchFredHistory('DGS2', years, freq),
  fedfunds: (years, freq) => fetchFredHistory('FEDFUNDS', years, freq),
  cpi: (years, freq) => fetchFredYoYHistory('CPIAUCSL', years, freq),
  joblessClaims: (years, freq) => fetchJoblessHistory(years, freq),
  payrolls: (years, freq) => fetchPayrollsHistory(years, freq),
  yieldCurve: (years, freq) => fetchYieldCurveHistory(years, freq),
  hySpread: (years, freq) => fetchFredHistory('BAMLH0A0HYM2', years, freq),
  igSpread: (years, freq) => fetchFredHistory('BAMLC0A0CM', years, freq),
  sp500: (years, freq) => fetchYahooHistory('^GSPC', years, freq),
  dxy: (years, freq) => fetchYahooHistory('DX-Y.NYB', years, freq),
  gold: (years, freq) => fetchYahooHistory('GC=F', years, freq),
  oil: (years, freq) => fetchYahooHistory('CL=F', years, freq),
  copper: (years, freq) => fetchYahooHistory('HG=F', years, freq),
  silver: (years, freq) => fetchYahooHistory('SI=F', years, freq),
  mortgage30: (years, freq) => fetchFredHistory('MORTGAGE30US', years, freq),
  homePriceYoY: (years, freq) => fetchFredYoYHistory('CSUSHPINSA', years, freq),
  nasdaq: (years, freq) => fetchYahooHistory('^IXIC', years, freq),
  russell2000: (years, freq) => fetchYahooHistory('^RUT', years, freq),
}

export const HISTORY_KEYS = Object.freeze(Object.keys(HISTORY_FETCHERS))

export function isHistoryKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(HISTORY_FETCHERS, key)
}

export async function fetchHistoryByKey(key: string, years = 10, freq: Freq = 'd'): Promise<DataPoint[] | null> {
  const fetcher = HISTORY_FETCHERS[key]
  if (!fetcher) return null
  return fetcher(years, freq)
}

export async function fetchHistoryForKeys(keys: string[], years = 10, freq: Freq = 'd'): Promise<HistoryMap> {
  const unique = Array.from(new Set(keys))
  const entries = await Promise.all(unique.map(async key => [key, await fetchHistoryByKey(key, years, freq)] as const))
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, DataPoint[]] => entry[1] != null))
}

export function downsampleSeries(series: DataPoint[], maxPoints: number): DataPoint[] {
  if (maxPoints <= 0 || series.length <= maxPoints) return series
  const recent = series.slice(-Math.max(maxPoints * 4, maxPoints))
  const step = Math.max(1, Math.ceil(recent.length / maxPoints))
  return recent.filter((_, i) => i % step === 0).slice(-maxPoints)
}

// years/freq let callers trade detail for speed: the indicator modal wants the
// full 10y daily series, but the Overview only needs ~1y for what-changed and
// monthly points for the long-range trend.
export async function fetchAllHistory(years = 10, freq: Freq = 'd'): Promise<HistoryMap> {
  return fetchHistoryForKeys([...HISTORY_KEYS], years, freq)
}
