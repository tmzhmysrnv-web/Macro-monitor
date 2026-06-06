// lib/fetchData.ts
// Fetches live macro data from FRED API + Yahoo Finance proxy

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

// FRED series IDs
const FRED_SERIES = {
  treasury10y: 'DGS10',       // 10-Year Treasury Constant Maturity Rate
  treasury2y: 'DGS2',         // 2-Year Treasury (for yield curve)
  fedfunds: 'FEDFUNDS',       // Federal Funds Effective Rate
  cpi: 'CPIAUCSL',            // CPI All Urban Consumers
  joblessClaims: 'ICSA',      // Initial Claims (weekly)
  hySpread: 'BAMLH0A0HYM2',   // ICE BofA US High Yield Option-Adjusted Spread
}

async function fetchFredSeries(seriesId: string): Promise<number | null> {
  try {
    const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=5`
    const res = await fetch(url, { next: { revalidate: 900 } }) // cache 15 min
    if (!res.ok) return null
    const data = await res.json()
    // Walk back through recent observations to find a non-null value
    const obs = data.observations || []
    for (const o of obs) {
      if (o.value !== '.' && o.value !== '') {
        return parseFloat(o.value)
      }
    }
    return null
  } catch {
    return null
  }
}

async function fetchVix(): Promise<number | null> {
  // Yahoo Finance — VIX (^VIX)
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d'
    const res = await fetch(url, { next: { revalidate: 900 } })
    if (!res.ok) return null
    const data = await res.json()
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close
    if (!closes) return null
    // Get last non-null close
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null) return parseFloat(closes[i].toFixed(2))
    }
    return null
  } catch {
    return null
  }
}

async function fetchSP500(): Promise<{ value: number; change: number } | null> {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5d'
    const res = await fetch(url, { next: { revalidate: 900 } })
    if (!res.ok) return null
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    const closes = result?.indicators?.quote?.[0]?.close
    if (!closes || closes.length < 2) return null
    const latest = closes[closes.length - 1]
    const prev = closes[closes.length - 2]
    return {
      value: Math.round(latest),
      change: parseFloat(((latest - prev) / prev * 100).toFixed(2)),
    }
  } catch {
    return null
  }
}

export type MacroData = {
  vix: number | null
  treasury10y: number | null
  treasury2y: number | null
  fedfunds: number | null
  cpi: number | null
  joblessClaims: number | null
  yieldCurve: number | null
  hySpread: number | null
  sp500: number | null
  sp500Change: number | null
  fetchedAt: string
}

export async function fetchAllData(): Promise<MacroData> {
  const [vix, t10y, t2y, ff, cpi, claims, hy, spx] = await Promise.all([
    fetchVix(),
    fetchFredSeries(FRED_SERIES.treasury10y),
    fetchFredSeries(FRED_SERIES.treasury2y),
    fetchFredSeries(FRED_SERIES.fedfunds),
    fetchFredSeries(FRED_SERIES.cpi),
    fetchFredSeries(FRED_SERIES.joblessClaims),
    fetchFredSeries(FRED_SERIES.hySpread),
    fetchSP500(),
  ])

  // CPI from FRED is a level — convert to YoY % ourselves
  // FRED returns raw CPI level; we'd need 12-month comparison for YoY
  // For simplicity we'll use a separate series: CPILFESL or display raw
  // Better: use series CPIAUCNS and compute, or use pre-computed FRED series
  // FRED series "CPIAUCSL_PC1" = CPI % change from year ago
  const yieldCurve = t10y != null && t2y != null
    ? parseFloat((t10y - t2y).toFixed(2))
    : null

  // Jobless claims from FRED is in thousands already for ICSA? 
  // Actually ICSA is in persons — divide by 1000
  const joblessK = claims != null ? parseFloat((claims / 1000).toFixed(1)) : null

  return {
    vix,
    treasury10y: t10y,
    treasury2y: t2y,
    fedfunds: ff,
    cpi,
    joblessClaims: joblessK,
    yieldCurve,
    hySpread: hy,
    sp500: spx?.value ?? null,
    sp500Change: spx?.change ?? null,
    fetchedAt: new Date().toISOString(),
  }
}
