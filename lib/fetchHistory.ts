// lib/fetchHistory.ts
// Fetches multi-year historical time series from FRED + Yahoo Finance
// Used for the interactive chart on each card

import { fredFetch } from './fred'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

export type DataPoint = { date: string; value: number }

async function fetchFredHistory(seriesId: string, years = 10): Promise<DataPoint[]> {
  try {
    const start = new Date()
    start.setFullYear(start.getFullYear() - years)
    const startStr = start.toISOString().split('T')[0]
    // limit=100000 (FRED max): daily series have ~5200 obs over 20yrs; the
    // previous limit=1000 with asc sort truncated them to the oldest ~4 years.
    const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=asc&observation_start=${startStr}&limit=100000`
    const res = await fredFetch(url, { next: { revalidate: 86400 } }) // cache 24h
    if (!res || !res.ok) return []
    const data = await res.json()
    return (data.observations || [])
      .filter((o: { value: string; date: string }) => o.value !== '.' && o.value !== '')
      .map((o: { value: string; date: string }) => ({ date: o.date, value: parseFloat(o.value) }))
  } catch { return [] }
}

async function fetchYahooHistory(symbol: string, years = 10): Promise<DataPoint[]> {
  try {
    const range = `${years}y`
    const encoded = encodeURIComponent(symbol)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1wk&range=${range}`
    const res = await fetch(url, { next: { revalidate: 86400 } })
    if (!res.ok) return []
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    const timestamps: number[] = result?.timestamp || []
    const closes: number[] = result?.indicators?.quote?.[0]?.close || []
    return timestamps
      .map((ts: number, i: number) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        value: closes[i],
      }))
      .filter(d => d.value != null && !isNaN(d.value))
  } catch { return [] }
}

async function fetchFredYoYHistory(seriesId: string, years = 10): Promise<DataPoint[]> {
  // Fetch extra year so we can compute YoY
  const raw = await fetchFredHistory(seriesId, years + 1)
  if (raw.length < 13) return raw
  // Compute YoY % change
  return raw.slice(12).map((point, i) => ({
    date: point.date,
    value: parseFloat(((point.value - raw[i].value) / raw[i].value * 100).toFixed(2)),
  }))
}

async function fetchJoblessHistory(years = 10): Promise<DataPoint[]> {
  const raw = await fetchFredHistory('ICSA', years)
  return raw.map(d => ({ date: d.date, value: parseFloat((d.value / 1000).toFixed(1)) }))
}

async function fetchYieldCurveHistory(years = 10): Promise<DataPoint[]> {
  const [t10, t2] = await Promise.all([
    fetchFredHistory('DGS10', years),
    fetchFredHistory('DGS2', years),
  ])
  // Align by date
  const t2Map = new Map(t2.map(d => [d.date, d.value]))
  return t10
    .filter(d => t2Map.has(d.date))
    .map(d => ({ date: d.date, value: parseFloat((d.value - t2Map.get(d.date)!).toFixed(2)) }))
}

export type HistoryMap = Record<string, DataPoint[]>

export async function fetchAllHistory(): Promise<HistoryMap> {
  const [vix, t10y, fedfunds, cpi, jobless, yieldCurve, hySpread, igSpread, sp500, dxy, gold, oil, copper, mortgage30, homePriceYoY] =
    await Promise.all([
      fetchYahooHistory('^VIX'),
      fetchFredHistory('DGS10'),
      fetchFredHistory('FEDFUNDS'),
      fetchFredYoYHistory('CPIAUCSL'),
      fetchJoblessHistory(),
      fetchYieldCurveHistory(),
      fetchFredHistory('BAMLH0A0HYM2'),
      fetchFredHistory('BAMLC0A0CM'),
      fetchYahooHistory('^GSPC'),
      fetchYahooHistory('DX-Y.NYB'),
      fetchYahooHistory('GC=F'),
      fetchYahooHistory('CL=F'),
      fetchYahooHistory('HG=F'),
      fetchFredHistory('MORTGAGE30US'),
      fetchFredYoYHistory('CSUSHPINSA'),  // home-price YoY (crash signal for the Break Meter)
    ])

  return { vix, treasury10y: t10y, fedfunds, cpi, joblessClaims: jobless, yieldCurve, hySpread, igSpread, sp500, dxy, gold, oil, copper, mortgage30, homePriceYoY }
}
