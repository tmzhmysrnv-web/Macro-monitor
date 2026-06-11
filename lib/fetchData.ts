// lib/fetchData.ts
import { fredFetch } from './fred'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

const FRED_SERIES = {
  treasury10y:  'DGS10',
  treasury2y:   'DGS2',
  fedfunds:     'FEDFUNDS',
  cpi:          'CPIAUCSL',       // CPI level; fetched with units=pc1 for YoY %
  joblessClaims:'ICSA',
  hySpread:     'BAMLH0A0HYM2',
  igSpread:     'BAMLC0A0CM',
  mortgage30:   'MORTGAGE30US',   // 30-year fixed mortgage rate (housing affordability)
}

async function fetchFredSeries(seriesId: string, units = 'lin', limit = 5): Promise<number | null> {
  try {
    const url = `${FRED_BASE}?series_id=${seriesId}&units=${units}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${limit}`
    const res = await fredFetch(url, { next: { revalidate: 900 } })
    if (!res || !res.ok) return null
    const data = await res.json()
    for (const o of (data.observations || [])) {
      if (o.value !== '.' && o.value !== '') return parseFloat(o.value)
    }
    return null
  } catch { return null }
}

async function fetchYahoo(symbol: string): Promise<{ value: number; change: number } | null> {
  try {
    const encoded = encodeURIComponent(symbol)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d`
    const res = await fetch(url, { next: { revalidate: 900 } })
    if (!res.ok) return null
    const data = await res.json()
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    if (!closes || closes.length < 2) return null
    let latest: number | null = null, prev: number | null = null
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null) { if (latest == null) latest = closes[i]; else if (prev == null) { prev = closes[i]; break } }
    }
    if (latest == null || prev == null) return null
    return { value: latest, change: parseFloat(((latest - prev) / prev * 100).toFixed(2)) }
  } catch { return null }
}

export type MacroData = {
  vix:           number | null
  treasury10y:   number | null
  treasury2y:    number | null
  fedfunds:      number | null
  cpi:           number | null
  joblessClaims: number | null
  yieldCurve:    number | null
  hySpread:      number | null
  igSpread:      number | null
  sp500:         number | null
  sp500Change:   number | null
  // Commodities & Dollar
  dxy:           number | null
  dxyChange:     number | null
  gold:          number | null
  goldChange:    number | null
  oil:           number | null
  oilChange:     number | null
  copper:        number | null
  copperChange:  number | null
  mortgage30:    number | null
  fetchedAt:     string
}

export async function fetchAllData(): Promise<MacroData> {
  const [t10y, t2y, ff, cpi, claims, hy, ig, mort, vixR, spxR, dxyR, goldR, oilR, copperR] = await Promise.all([
    fetchFredSeries(FRED_SERIES.treasury10y),
    fetchFredSeries(FRED_SERIES.treasury2y),
    fetchFredSeries(FRED_SERIES.fedfunds),
    fetchFredSeries(FRED_SERIES.cpi, 'pc1'),  // units=pc1 -> YoY % change
    fetchFredSeries(FRED_SERIES.joblessClaims),
    fetchFredSeries(FRED_SERIES.hySpread),
    fetchFredSeries(FRED_SERIES.igSpread),
    fetchFredSeries(FRED_SERIES.mortgage30),
    fetchYahoo('^VIX'),
    fetchYahoo('^GSPC'),
    fetchYahoo('DX-Y.NYB'),
    fetchYahoo('GC=F'),
    fetchYahoo('CL=F'),
    fetchYahoo('HG=F'),
  ])

  return {
    vix:           vixR != null ? parseFloat(vixR.value.toFixed(2)) : null,
    treasury10y:   t10y,
    treasury2y:    t2y,
    fedfunds:      ff,
    cpi:           cpi != null ? parseFloat(cpi.toFixed(2)) : null,
    joblessClaims: claims != null ? parseFloat((claims / 1000).toFixed(1)) : null,
    yieldCurve:    t10y != null && t2y != null ? parseFloat((t10y - t2y).toFixed(2)) : null,
    hySpread:      hy,
    igSpread:      ig,
    sp500:         spxR != null ? Math.round(spxR.value) : null,
    sp500Change:   spxR?.change ?? null,
    dxy:           dxyR != null ? parseFloat(dxyR.value.toFixed(2)) : null,
    dxyChange:     dxyR?.change ?? null,
    gold:          goldR != null ? Math.round(goldR.value) : null,
    goldChange:    goldR?.change ?? null,
    oil:           oilR != null ? parseFloat(oilR.value.toFixed(2)) : null,
    oilChange:     oilR?.change ?? null,
    copper:        copperR != null ? parseFloat(copperR.value.toFixed(3)) : null,
    copperChange:  copperR?.change ?? null,
    mortgage30:    mort,
    fetchedAt:     new Date().toISOString(),
  }
}
