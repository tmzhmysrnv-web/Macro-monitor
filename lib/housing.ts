// lib/housing.ts
// Housing status model: fetches FRED housing series, scores five categories
// (Affordability, Supply, Demand, Market Heat, Financial Stress), derives a
// single headline status, evaluates alerts, and computes "watching closely"
// distances to the next alert.
//
// Metric substitutions (no free public source):
//   Mortgage applications  -> New home sales (HSN1F) as a demand proxy
//   Pending sales/showings -> covered by existing+new home sales
//   Sale-to-list/multi-offer -> price-cut share (PRIREDCOUUS / ACTLISCOUUS)
//   Foreclosure rate       -> mortgage delinquency (DRSFRMACBS)
//   Payment-to-income      -> NAR Housing Affordability Index (FIXHAI)

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

export type Obs = { date: string; value: number }

async function fredSeries(seriesId: string, limit: number, units = 'lin'): Promise<Obs[]> {
  try {
    const url = `${FRED_BASE}?series_id=${seriesId}&units=${units}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${limit}`
    const res = await fetch(url, { next: { revalidate: 3600 } }) // cache 1h
    if (!res.ok) return []
    const data = await res.json()
    return (data.observations || [])
      .filter((o: { value: string }) => o.value !== '.' && o.value !== '')
      .map((o: { date: string; value: string }) => ({ date: o.date, value: parseFloat(o.value) }))
  } catch { return [] }
}

// obs are newest-first. Value at (or just before) N months back from latest.
function valueAt(obs: Obs[], monthsBack: number): number | null {
  if (!obs.length) return null
  const target = new Date(obs[0].date)
  target.setMonth(target.getMonth() - monthsBack)
  for (const o of obs) {
    if (new Date(o.date) <= target) return o.value
  }
  return null
}

function pctChange(latest: number | null, past: number | null): number | null {
  if (latest == null || past == null || past === 0) return null
  return parseFloat(((latest - past) / Math.abs(past) * 100).toFixed(1))
}

export type Metric = {
  latest: number | null
  yoyPct: number | null    // % change vs ~12 months ago
  chg3m: number | null     // raw change vs ~3 months ago (same unit as series)
}

function metric(obs: Obs[]): Metric {
  const latest = obs[0]?.value ?? null
  return {
    latest,
    yoyPct: pctChange(latest, valueAt(obs, 12)),
    chg3m: latest != null && valueAt(obs, 3) != null
      ? parseFloat((latest - (valueAt(obs, 3) as number)).toFixed(2))
      : null,
  }
}

export type HousingData = {
  mortgage30: Metric & { history: Obs[] }
  affordabilityIndex: Metric
  homePriceYoY: number | null   // Case-Shiller YoY %
  wageYoY: number | null        // Avg hourly earnings YoY %
  activeListings: Metric
  newListings: Metric
  monthsSupply: Metric
  housingStarts: Metric
  permits: Metric
  existingSales: Metric
  newSales: Metric
  daysOnMarket: Metric
  priceCutShare: { latest: number | null; yearAgo: number | null }
  mortgageDelinq: Metric
  ccDelinq: Metric
  debtService: Metric
}

export async function fetchHousingData(): Promise<HousingData> {
  const [
    mort, hai, cs, wages, act, newl, msup, starts, permits,
    exSales, newSales, dom, priceRed, mDelinq, ccDel, tdsp,
  ] = await Promise.all([
    fredSeries('MORTGAGE30US', 340),         // weekly, ~6.5yrs (alert context lookback)
    fredSeries('FIXHAI', 22),                // monthly; extra window — series has gap months ('.')
    fredSeries('CSUSHPINSA', 15, 'pc1'),     // Case-Shiller, YoY % directly
    fredSeries('CES0500000003', 15, 'pc1'),  // wages, YoY % directly
    fredSeries('ACTLISCOUUS', 15),
    fredSeries('NEWLISCOUUS', 15),
    fredSeries('MSACSR', 15),
    fredSeries('HOUST', 15),
    fredSeries('PERMIT', 15),
    fredSeries('EXHOSLUSM495S', 15),
    fredSeries('HSN1F', 15),
    fredSeries('MEDDAYONMARUS', 15),
    fredSeries('PRIREDCOUUS', 15),
    fredSeries('DRSFRMACBS', 8),             // quarterly
    fredSeries('DRCCLACBS', 8),
    fredSeries('TDSP', 8),
  ])

  // Price-cut share: price-reduced count / active listings, aligned by month
  const actByDate = new Map(act.map(o => [o.date, o.value]))
  const share = (o: Obs | undefined): number | null => {
    if (!o) return null
    const a = actByDate.get(o.date)
    return a ? parseFloat((o.value / a * 100).toFixed(1)) : null
  }
  const cutLatest = share(priceRed[0])
  const yearAgoObs = priceRed.find(o => {
    if (!priceRed[0]) return false
    const target = new Date(priceRed[0].date); target.setMonth(target.getMonth() - 12)
    return new Date(o.date) <= target
  })
  const cutYearAgo = share(yearAgoObs)

  return {
    mortgage30: { ...metric(mort), history: mort },
    affordabilityIndex: metric(hai),
    homePriceYoY: cs[0]?.value ?? null,
    wageYoY: wages[0]?.value ?? null,
    activeListings: metric(act),
    newListings: metric(newl),
    monthsSupply: metric(msup),
    housingStarts: metric(starts),
    permits: metric(permits),
    existingSales: metric(exSales),
    newSales: metric(newSales),
    daysOnMarket: metric(dom),
    priceCutShare: { latest: cutLatest, yearAgo: cutYearAgo },
    mortgageDelinq: metric(mDelinq),
    ccDelinq: metric(ccDel),
    debtService: metric(tdsp),
  }
}

// ── Category scoring ──────────────────────────────────────────────────
// good=favorable (green), neutral=middle/no signal (gray),
// warn=deteriorating (orange), bad=severe (red)
export type Tone = 'good' | 'neutral' | 'warn' | 'bad'
export type Category = {
  key: string
  label: string
  status: string          // human label per spec (Healthy / Constrained / ...)
  tone: Tone
  signals: string[]       // plain-English evidence lines shown in the UI
}

// +1 favorable, -1 unfavorable, 0 neutral/unknown
function sig(cond: boolean | null, favorable: boolean): number {
  if (cond == null || !cond) return 0
  return favorable ? 1 : -1
}

function scoreAffordability(d: HousingData): Category {
  const signals: string[] = []
  let score = 0
  if (d.mortgage30.chg3m != null) {
    if (d.mortgage30.chg3m <= -0.1) { score++; signals.push(`Mortgage rates down ${Math.abs(d.mortgage30.chg3m)}pp over 3 months`) }
    else if (d.mortgage30.chg3m >= 0.15) { score--; signals.push(`Mortgage rates up ${d.mortgage30.chg3m}pp over 3 months`) }
    else signals.push('Mortgage rates roughly flat over 3 months')
  }
  if (d.wageYoY != null && d.homePriceYoY != null) {
    const gap = parseFloat((d.wageYoY - d.homePriceYoY).toFixed(1))
    if (gap >= 0.5) { score++; signals.push(`Wages growing ${gap}pp faster than home prices`) }
    else if (gap <= -0.5) { score--; signals.push(`Home prices growing ${Math.abs(gap)}pp faster than wages`) }
    else signals.push('Wage and home-price growth roughly matched')
  }
  if (d.affordabilityIndex.yoyPct != null) {
    if (d.affordabilityIndex.yoyPct >= 2) { score++; signals.push(`Affordability index up ${d.affordabilityIndex.yoyPct}% YoY`) }
    else if (d.affordabilityIndex.yoyPct <= -2) { score--; signals.push(`Affordability index down ${Math.abs(d.affordabilityIndex.yoyPct)}% YoY`) }
    else signals.push('Affordability index stable YoY')
  } else if (d.affordabilityIndex.chg3m != null) {
    // FIXHAI is a young series (starts 2025-04) — use 3-month change until YoY exists
    if (d.affordabilityIndex.chg3m >= 2) { score++; signals.push(`Affordability index up ${d.affordabilityIndex.chg3m} points over 3 months`) }
    else if (d.affordabilityIndex.chg3m <= -2) { score--; signals.push(`Affordability index down ${Math.abs(d.affordabilityIndex.chg3m)} points over 3 months`) }
    else signals.push('Affordability index stable over 3 months')
  }
  const status = score >= 2 ? 'Healthy' : score <= -2 ? 'Deteriorating' : 'Neutral'
  const tone: Tone = status === 'Healthy' ? 'good' : status === 'Deteriorating' ? 'warn' : 'neutral'
  return { key: 'affordability', label: 'Affordability', status, tone, signals }
}

function scoreSupply(d: HousingData): Category {
  const signals: string[] = []
  let score = 0
  score += sig(d.activeListings.yoyPct != null && d.activeListings.yoyPct >= 5, true)
  score += sig(d.activeListings.yoyPct != null && d.activeListings.yoyPct <= -5, false)
  if (d.activeListings.yoyPct != null) signals.push(`Active listings ${d.activeListings.yoyPct >= 0 ? '+' : ''}${d.activeListings.yoyPct}% YoY`)
  score += sig(d.newListings.yoyPct != null && d.newListings.yoyPct >= 5, true)
  score += sig(d.newListings.yoyPct != null && d.newListings.yoyPct <= -5, false)
  if (d.newListings.yoyPct != null) signals.push(`New listings ${d.newListings.yoyPct >= 0 ? '+' : ''}${d.newListings.yoyPct}% YoY`)
  score += sig(d.housingStarts.yoyPct != null && d.housingStarts.yoyPct >= 3, true)
  score += sig(d.housingStarts.yoyPct != null && d.housingStarts.yoyPct <= -3, false)
  if (d.housingStarts.yoyPct != null) signals.push(`Housing starts ${d.housingStarts.yoyPct >= 0 ? '+' : ''}${d.housingStarts.yoyPct}% YoY`)
  score += sig(d.permits.yoyPct != null && d.permits.yoyPct >= 3, true)
  score += sig(d.permits.yoyPct != null && d.permits.yoyPct <= -3, false)
  if (d.permits.yoyPct != null) signals.push(`Building permits ${d.permits.yoyPct >= 0 ? '+' : ''}${d.permits.yoyPct}% YoY`)
  const status = score >= 2 ? 'Healthy' : score <= -2 ? 'Constrained' : 'Neutral'
  const tone: Tone = status === 'Healthy' ? 'good' : status === 'Constrained' ? 'warn' : 'neutral'
  return { key: 'supply', label: 'Supply', status, tone, signals }
}

function scoreDemand(d: HousingData): Category {
  const signals: string[] = []
  let score = 0
  score += sig(d.existingSales.yoyPct != null && d.existingSales.yoyPct >= 3, true)
  score += sig(d.existingSales.yoyPct != null && d.existingSales.yoyPct <= -3, false)
  if (d.existingSales.yoyPct != null) signals.push(`Existing home sales ${d.existingSales.yoyPct >= 0 ? '+' : ''}${d.existingSales.yoyPct}% YoY`)
  score += sig(d.newSales.yoyPct != null && d.newSales.yoyPct >= 3, true)
  score += sig(d.newSales.yoyPct != null && d.newSales.yoyPct <= -3, false)
  if (d.newSales.yoyPct != null) signals.push(`New home sales ${d.newSales.yoyPct >= 0 ? '+' : ''}${d.newSales.yoyPct}% YoY`)
  const status = score >= 2 ? 'Strong' : score <= -2 ? 'Weakening' : 'Stable'
  const tone: Tone = status === 'Strong' ? 'good' : status === 'Weakening' ? 'warn' : 'neutral'
  return { key: 'demand', label: 'Demand', status, tone, signals }
}

function scoreHeat(d: HousingData): Category {
  const signals: string[] = []
  let score = 0
  let severe = 0
  if (d.daysOnMarket.yoyPct != null) {
    if (d.daysOnMarket.yoyPct <= -5) { score++; signals.push(`Homes selling ${Math.abs(d.daysOnMarket.yoyPct)}% faster than a year ago`) }
    else if (d.daysOnMarket.yoyPct >= 5) {
      score--
      signals.push(`Homes taking ${d.daysOnMarket.yoyPct}% longer to sell than a year ago`)
      if (d.daysOnMarket.yoyPct >= 20) severe++
    } else signals.push('Days on market steady YoY')
  }
  const { latest: cut, yearAgo: cutPrev } = d.priceCutShare
  if (cut != null && cutPrev != null) {
    const diff = parseFloat((cut - cutPrev).toFixed(1))
    if (diff <= -2) { score++; signals.push(`Price cuts down to ${cut}% of listings (from ${cutPrev}%)`) }
    else if (diff >= 2) {
      score--
      signals.push(`Price cuts up to ${cut}% of listings (from ${cutPrev}%)`)
      if (diff >= 8) severe++
    } else signals.push(`Price cuts steady at ~${cut}% of listings`)
  }
  let status: string
  if (score >= 2) status = 'Hot'
  else if (score <= -2 && severe >= 1) status = 'Frozen'
  else if (score <= -1) status = 'Cooling'
  else status = 'Balanced'
  const tone: Tone = status === 'Frozen' ? 'bad' : status === 'Cooling' ? 'warn' : status === 'Hot' ? 'good' : 'neutral'
  return { key: 'heat', label: 'Market Heat', status, tone, signals }
}

function scoreStress(d: HousingData): Category {
  const signals: string[] = []
  const mYoY = d.mortgageDelinq.yoyPct
  const cYoY = d.ccDelinq.yoyPct
  const mLevel = d.mortgageDelinq.latest
  if (mLevel != null) signals.push(`Mortgage delinquencies at ${mLevel}%${mYoY != null ? ` (${mYoY >= 0 ? '+' : ''}${mYoY}% YoY)` : ''}`)
  if (d.ccDelinq.latest != null) signals.push(`Card delinquencies at ${d.ccDelinq.latest}%${cYoY != null ? ` (${cYoY >= 0 ? '+' : ''}${cYoY}% YoY)` : ''}`)
  if (d.debtService.latest != null) signals.push(`Household debt service at ${d.debtService.latest.toFixed(1)}% of income`)
  let status: string = 'Stable'
  if ((mYoY != null && mYoY >= 30) || (mLevel != null && mLevel >= 5)) status = 'Stressed'
  else if ((mYoY != null && mYoY >= 10) || (cYoY != null && cYoY >= 10)) status = 'Elevated'
  const tone: Tone = status === 'Stressed' ? 'bad' : status === 'Elevated' ? 'warn' : 'neutral'
  return { key: 'stress', label: 'Financial Stress', status, tone, signals }
}

// ── Overall status engine ─────────────────────────────────────────────
export type HousingStatus = { emoji: string; label: string; tone: Tone | 'crisis' }

function overallStatus(c: Record<string, Category>): HousingStatus {
  const aff = c.affordability.status, sup = c.supply.status,
        dem = c.demand.status, heat = c.heat.status, str = c.stress.status
  if (str === 'Stressed' && (dem === 'Weakening' || heat === 'Frozen'))
    return { emoji: '🚨', label: 'Housing Correction', tone: 'crisis' }
  if (str === 'Stressed') return { emoji: '🔴', label: 'Financial Stress', tone: 'bad' }
  if (dem === 'Weakening' && heat === 'Frozen') return { emoji: '🔴', label: 'Demand Shock', tone: 'bad' }
  if (aff === 'Deteriorating' && dem !== 'Strong') return { emoji: '🟠', label: 'Affordability Crunch', tone: 'warn' }
  if (heat === 'Cooling' || dem === 'Weakening' || sup === 'Constrained')
    return { emoji: '🟠', label: 'Recovery Cooling', tone: 'warn' }
  if (aff === 'Healthy' && dem === 'Strong') return { emoji: '🟢', label: 'Healthy Expansion', tone: 'good' }
  return { emoji: '🟢', label: 'Balanced Market', tone: 'good' }
}

// ── Alerts ────────────────────────────────────────────────────────────
export type HousingAlert = {
  id: string
  title: string
  what: string
  why: string
  affected: string[]
  context: string
}

// Months since the mortgage rate was last at/above `level` (excluding now)
function monthsSinceAbove(history: Obs[], level: number): number | null {
  if (history.length < 2) return null
  const latestDate = new Date(history[0].date)
  for (let i = 1; i < history.length; i++) {
    if (history[i].value >= level) {
      const d = new Date(history[i].date)
      return Math.round((latestDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.4))
    }
  }
  return null // never in the fetched window
}

function buildAlerts(d: HousingData): HousingAlert[] {
  const alerts: HousingAlert[] = []
  const rate = d.mortgage30.latest

  if (rate != null && rate >= 8) {
    const m = monthsSinceAbove(d.mortgage30.history.slice(1), 8)
    alerts.push({
      id: 'mortgage-8', title: 'Mortgage Rates Crossed 8%',
      what: `The 30-year fixed rate is at ${rate}%.`,
      why: 'Rates at 8% put monthly payments out of reach for most first-time buyers and freeze move-up activity.',
      affected: ['Affordability', 'Home Sales', 'Construction Activity'],
      context: m != null ? `First break above 8% in ${m} months.` : 'No break above 8% in the past ~6 years before this.',
    })
  } else if (rate != null && rate >= 7) {
    const m = monthsSinceAbove(d.mortgage30.history.slice(1), 7)
    alerts.push({
      id: 'mortgage-7', title: 'Mortgage Rates Crossed 7%',
      what: `The 30-year fixed rate is at ${rate}%.`,
      why: 'Higher mortgage rates reduce affordability and suppress buyer demand.',
      affected: ['Affordability', 'Home Sales', 'Construction Activity'],
      context: m != null ? `First break above 7% in ${m} months.` : 'No break above 7% in the past ~6 years before this.',
    })
  }

  if (d.monthsSupply.latest != null && d.monthsSupply.latest < 3) {
    alerts.push({
      id: 'supply-tight', title: 'Inventory Below 3 Months of Supply',
      what: `Months of supply is at ${d.monthsSupply.latest}.`,
      why: 'Under 3 months of supply, buyers compete for scarce homes and prices get bid up regardless of affordability.',
      affected: ['Supply', 'Market Heat', 'Home Prices'],
      context: 'A balanced market is typically 4–6 months of supply.',
    })
  }

  if (d.existingSales.yoyPct != null && d.existingSales.yoyPct <= -10) {
    alerts.push({
      id: 'sales-drop', title: 'Existing Home Sales Down Over 10% YoY',
      what: `Existing home sales are ${d.existingSales.yoyPct}% below a year ago.`,
      why: 'A double-digit sales decline signals buyers stepping back broadly — the demand side of the market is contracting.',
      affected: ['Demand', 'Market Heat', 'Realtor & lending activity'],
      context: 'Declines of this size have historically accompanied affordability shocks or recessions.',
    })
  }

  if (d.newSales.yoyPct != null && d.newSales.yoyPct <= -15) {
    alerts.push({
      id: 'newsales-drop', title: 'New Home Sales Down Over 15% YoY',
      what: `New home sales are ${d.newSales.yoyPct}% below a year ago.`,
      why: 'Builders respond to falling sales by cutting starts, which feeds back into construction employment.',
      affected: ['Demand', 'Construction Activity', 'Supply pipeline'],
      context: 'Used as a proxy for mortgage-application demand (no free public source for applications).',
    })
  }

  if (d.mortgageDelinq.yoyPct != null && d.mortgageDelinq.yoyPct >= 20) {
    alerts.push({
      id: 'delinq-spike', title: 'Mortgage Delinquencies Up Over 20% YoY',
      what: `Delinquency rate is ${d.mortgageDelinq.latest}%, up ${d.mortgageDelinq.yoyPct}% from a year ago.`,
      why: 'Rapidly rising delinquencies are the earliest sign of household financial stress reaching housing.',
      affected: ['Financial Stress', 'Credit availability', 'Foreclosure pipeline'],
      context: 'Delinquencies led the 2008 correction by roughly 18 months.',
    })
  }

  return alerts
}

// ── Watching closely ──────────────────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number } // 0..1, 1 = at threshold

function buildWatching(d: HousingData, alerts: HousingAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []

  const rate = d.mortgage30.latest
  if (rate != null && !firing.has('mortgage-7') && !firing.has('mortgage-8')) {
    const dist = parseFloat((7 - rate).toFixed(2))
    items.push({ label: 'Mortgage rates', text: `${dist}pp below the 7% alert`, proximity: Math.max(0, Math.min(1, rate / 7)) })
  } else if (rate != null && firing.has('mortgage-7') && !firing.has('mortgage-8')) {
    const dist = parseFloat((8 - rate).toFixed(2))
    items.push({ label: 'Mortgage rates', text: `${dist}pp below the 8% alert`, proximity: Math.max(0, Math.min(1, rate / 8)) })
  }

  if (d.monthsSupply.latest != null && !firing.has('supply-tight')) {
    const v = d.monthsSupply.latest
    items.push({ label: 'Months of supply', text: `${parseFloat((v - 3).toFixed(1))} months above the tight-supply alert (3.0)`, proximity: Math.max(0, Math.min(1, 3 / v)) })
  }

  if (d.existingSales.yoyPct != null && !firing.has('sales-drop')) {
    const v = d.existingSales.yoyPct
    items.push({ label: 'Existing home sales', text: `${parseFloat((v + 10).toFixed(1))}pp above the −10% YoY alert`, proximity: Math.max(0, Math.min(1, v <= 0 ? Math.abs(v) / 10 : 0)) })
  }

  if (d.mortgageDelinq.yoyPct != null && !firing.has('delinq-spike')) {
    const v = d.mortgageDelinq.yoyPct
    items.push({ label: 'Mortgage delinquencies', text: `${parseFloat((20 - v).toFixed(1))}pp below the +20% YoY alert`, proximity: Math.max(0, Math.min(1, v > 0 ? v / 20 : 0)) })
  }

  return items.sort((a, b) => b.proximity - a.proximity)
}

// ── Public entry point ────────────────────────────────────────────────
export type HousingModel = {
  status: HousingStatus
  categories: Category[]
  alerts: HousingAlert[]
  watching: WatchItem[]
  data: HousingData
}

export async function buildHousingModel(): Promise<HousingModel> {
  const data = await fetchHousingData()
  const categories = [
    scoreAffordability(data),
    scoreSupply(data),
    scoreDemand(data),
    scoreHeat(data),
    scoreStress(data),
  ]
  const byKey = Object.fromEntries(categories.map(c => [c.key, c]))
  const status = overallStatus(byKey as Record<string, Category>)
  const alerts = buildAlerts(data)
  const watching = buildWatching(data, alerts)
  return { status, categories, alerts, watching, data }
}
