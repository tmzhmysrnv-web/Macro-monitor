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

import { fredFetch } from './fred'
import { toneHigh, toneLow, type Tone as MetricTone } from './metricTone'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

export type Obs = { date: string; value: number }

async function fredSeries(seriesId: string, limit: number, units = 'lin'): Promise<Obs[]> {
  try {
    const url = `${FRED_BASE}?series_id=${seriesId}&units=${units}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${limit}`
    const res = await fredFetch(url, { next: { revalidate: 3600 } }) // cache 1h
    if (!res || !res.ok) return []
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

// Downsample newest-first obs to an oldest→newest series (~`max` points) for the
// interactive driver-card sparkline + expand chart.
export function spark(obs: Obs[], max = 48): { date: string; value: number }[] | undefined {
  if (!obs || obs.length < 2) return undefined
  const asc = [...obs].reverse()
  if (asc.length <= max) return asc.map(o => ({ date: o.date, value: o.value }))
  const step = Math.ceil(asc.length / max)
  return asc.filter((_, i) => i % step === 0 || i === asc.length - 1).map(o => ({ date: o.date, value: o.value }))
}

export type Metric = {
  latest: number | null
  yoyPct: number | null    // % change vs ~12 months ago
  chg3m: number | null     // raw change vs ~3 months ago (same unit as series)
  obs: Obs[]               // source observations (newest-first) for sparklines
}

function metric(obs: Obs[]): Metric {
  const latest = obs[0]?.value ?? null
  return {
    latest,
    yoyPct: pctChange(latest, valueAt(obs, 12)),
    chg3m: latest != null && valueAt(obs, 3) != null
      ? parseFloat((latest - (valueAt(obs, 3) as number)).toFixed(2))
      : null,
    obs,
  }
}

// ── Metric-card formatting (for the expandable driver cards) ───────────
export type MetricCard = {
  label: string; value: string; sub?: string; unit?: string
  tone?: MetricTone
  points?: { date: string; value: number }[]
  pctl?: number; histLabel?: string
  alertText?: string; alertProximity?: number
}

// Where the latest value sits within its own fetched history → "historically …".
function hist(obs: Obs[]): { pctl?: number; histLabel?: string } {
  if (!obs || obs.length < 8) return {}
  const vals = obs.map(o => o.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  if (max === min) return {}
  const pctl = Math.round((obs[0].value - min) / (max - min) * 100)
  const histLabel = pctl <= 20 ? 'historically low' : pctl < 40 ? 'below normal'
    : pctl <= 60 ? 'historically normal' : pctl < 80 ? 'above normal' : 'historically high'
  return { pctl, histLabel }
}
function alertAbove(value: number | null, threshold: number, unit = '%'): { alertText?: string; alertProximity?: number } {
  if (value == null || value >= threshold) return {}
  return { alertText: `${(threshold - value).toFixed(2)}${unit} from ${threshold}${unit} alert`, alertProximity: Math.max(0, Math.min(1, value / threshold)) }
}
function alertBelow(value: number | null, threshold: number, unit = ''): { alertText?: string; alertProximity?: number } {
  if (value == null || value <= threshold) return {}
  return { alertText: `${(value - threshold).toFixed(1)}${unit} above the ${threshold}${unit} alert`, alertProximity: Math.max(0, Math.min(1, threshold / value)) }
}

const fMoney = (v: number | null) => v == null ? '—' : `$${Math.round(v).toLocaleString('en-US')}`
const fPct = (v: number | null, d = 2) => v == null ? '—' : `${v.toFixed(d)}%`
const fIndex = (v: number | null) => v == null ? '—' : v.toFixed(0)
// Raw counts (listings, existing sales): 1.06M / 475K
const fCount = (v: number | null) => v == null ? '—' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : `${Math.round(v / 1e3)}K`
// Series already expressed in thousands (starts, permits, new sales): 1.47M / 622K
const fThou = (v: number | null) => v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)}M` : `${Math.round(v)}K`
const subYoY = (m: Metric): string | undefined => m.yoyPct == null ? undefined : `${m.yoyPct >= 0 ? '+' : ''}${m.yoyPct}% YoY`

export type HousingData = {
  mortgage30: Metric & { history: Obs[] }
  affordabilityIndex: Metric
  medianPrice: Metric           // MSPUS median sales price ($)
  homePriceYoY: number | null   // Case-Shiller YoY %
  homePriceYoYObs: Obs[]
  wageYoY: number | null        // Avg hourly earnings YoY %
  wageYoYObs: Obs[]
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
    mort, hai, mspus, cs, wages, act, newl, msup, starts, permits,
    exSales, newSales, dom, priceRed, mDelinq, ccDel, tdsp,
  ] = await Promise.all([
    fredSeries('MORTGAGE30US', 340),         // weekly, ~6.5yrs (alert context lookback)
    fredSeries('FIXHAI', 140),               // monthly; extra window — series has gap months ('.')
    fredSeries('MSPUS', 44),                 // median sales price, quarterly
    fredSeries('CSUSHPINSA', 140, 'pc1'),    // Case-Shiller, YoY % directly
    fredSeries('CES0500000003', 140, 'pc1'), // wages, YoY % directly
    fredSeries('ACTLISCOUUS', 90),
    fredSeries('NEWLISCOUUS', 90),
    fredSeries('MSACSR', 140),
    fredSeries('HOUST', 140),
    fredSeries('PERMIT', 140),
    fredSeries('EXHOSLUSM495S', 140),
    fredSeries('HSN1F', 140),
    fredSeries('MEDDAYONMARUS', 90),
    fredSeries('PRIREDCOUUS', 90),
    fredSeries('DRSFRMACBS', 44),            // quarterly
    fredSeries('DRCCLACBS', 44),
    fredSeries('TDSP', 44),
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
    medianPrice: metric(mspus),
    homePriceYoY: cs[0]?.value ?? null,
    homePriceYoYObs: cs,
    wageYoY: wages[0]?.value ?? null,
    wageYoYObs: wages,
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
  status: string          // meaningful state label (Pressured / Tight / Strong / ...)
  tone: Tone
  fill: number            // 0..1 health for the progress bar (1 = healthiest)
  signals: string[]       // plain-English evidence lines shown in the UI
  metrics: MetricCard[]   // underlying metric values, shown as cards on expand
}

// Tone → progress-bar fill (higher = healthier)
const TONE_FILL: Record<Tone, number> = { good: 0.9, neutral: 0.5, warn: 0.42, bad: 0.18 }
function withFill(c: Omit<Category, 'fill'>): Category {
  return { ...c, fill: TONE_FILL[c.tone] }
}

// +1 favorable, -1 unfavorable, 0 neutral/unknown
function sig(cond: boolean | null, favorable: boolean): number {
  if (cond == null || !cond) return 0
  return favorable ? 1 : -1
}

function scoreAffordability(d: HousingData): Omit<Category, 'fill'> {
  const signals: string[] = []
  // Level-aware: the ABSOLUTE state of affordability drives the score, with
  // recent direction as a secondary modifier. (A flat trend at a punishing
  // level is still "poor" — this is the lived "can't afford a home" reality.)
  let level = 0  // higher = more affordable

  // Absolute affordability index (NAR: 100 = median family exactly qualifies)
  const idx = d.affordabilityIndex.latest
  if (idx != null) {
    if (idx >= 150) { level += 2; signals.push(`Affordability index ${idx.toFixed(0)} — comfortable (100 = a median-income family exactly qualifies for a median home)`) }
    else if (idx >= 125) { level += 1; signals.push(`Affordability index ${idx.toFixed(0)} — moderate (100 = a median-income family exactly qualifies)`) }
    else if (idx >= 110) { signals.push(`Affordability index ${idx.toFixed(0)} — stretched; barely above the 100 line where a median family only just qualifies`) }
    else { level -= 2; signals.push(`Affordability index ${idx.toFixed(0)} — poor; near the weakest on record, with a median-income family unable to comfortably afford a median home`) }
  }

  // Absolute mortgage-rate level vs the 3–4% norm of the 2010s
  const rate = d.mortgage30.latest
  if (rate != null) {
    if (rate >= 7) { level -= 2; signals.push(`Mortgage rate ${rate}% — very high; monthly payments far above the 3–4% era most buyers anchor to`) }
    else if (rate >= 6) { level -= 1; signals.push(`Mortgage rate ${rate}% — elevated; well above the 3–4% of the 2010s, adding hundreds to a typical payment`) }
    else if (rate < 4) { level += 1; signals.push(`Mortgage rate ${rate}% — low`) }
    else signals.push(`Mortgage rate ${rate}%`)
  }

  // Direction of travel (secondary)
  if (d.mortgage30.chg3m != null) {
    if (d.mortgage30.chg3m <= -0.1) { level += 1; signals.push(`Rates easing — down ${Math.abs(d.mortgage30.chg3m)}pp over 3 months`) }
    else if (d.mortgage30.chg3m >= 0.15) { level -= 1; signals.push(`Rates rising — up ${d.mortgage30.chg3m}pp over 3 months`) }
  }
  if (d.wageYoY != null && d.homePriceYoY != null) {
    const gap = parseFloat((d.wageYoY - d.homePriceYoY).toFixed(1))
    if (gap >= 0.5) { level += 1; signals.push(`Wages growing ${gap}pp faster than home prices — slowly chipping away at the gap`) }
    else if (gap <= -0.5) { level -= 1; signals.push(`Home prices growing ${Math.abs(gap)}pp faster than wages — the gap is still widening`) }
  }

  const status = level >= 1 ? 'Improving' : level <= -2 ? 'Deteriorating' : 'Pressured'
  const tone: Tone = status === 'Improving' ? 'good' : status === 'Pressured' ? 'warn' : 'bad'
  const metrics: MetricCard[] = [
    { label: '30Y Mortgage Rate', value: fPct(rate), unit: '%', tone: toneHigh(rate, 7, 9), points: spark(d.mortgage30.obs), ...hist(d.mortgage30.obs), ...alertAbove(rate, 7), sub: d.mortgage30.chg3m != null ? `${d.mortgage30.chg3m >= 0 ? '+' : ''}${d.mortgage30.chg3m}pp 3mo` : undefined },
    { label: 'Affordability Index', value: fIndex(idx), points: spark(d.affordabilityIndex.obs), ...hist(d.affordabilityIndex.obs), sub: subYoY(d.affordabilityIndex) ?? (d.affordabilityIndex.chg3m != null ? `${d.affordabilityIndex.chg3m >= 0 ? '+' : ''}${d.affordabilityIndex.chg3m} 3mo` : undefined) },
    { label: 'Median Home Price', value: fMoney(d.medianPrice.latest), points: spark(d.medianPrice.obs), ...hist(d.medianPrice.obs), sub: subYoY(d.medianPrice) },
    { label: 'Home Price Growth', value: fPct(d.homePriceYoY, 1), unit: '%', points: spark(d.homePriceYoYObs), ...hist(d.homePriceYoYObs), sub: 'YoY' },
    { label: 'Wage Growth', value: fPct(d.wageYoY, 1), unit: '%', points: spark(d.wageYoYObs), ...hist(d.wageYoYObs), sub: 'YoY' },
  ]
  return { key: 'affordability', label: 'Affordability', status, tone, signals, metrics }
}

function scoreSupply(d: HousingData): Omit<Category, 'fill'> {
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
  const status = score >= 2 ? 'Expanding' : score <= -2 ? 'Tight' : 'Healthy'
  const tone: Tone = status === 'Tight' ? 'warn' : 'good' // Expanding & Healthy both green
  const metrics: MetricCard[] = [
    { label: 'Active Listings', value: fCount(d.activeListings.latest), points: spark(d.activeListings.obs), ...hist(d.activeListings.obs), sub: subYoY(d.activeListings) },
    { label: 'New Listings', value: fCount(d.newListings.latest), points: spark(d.newListings.obs), ...hist(d.newListings.obs), sub: subYoY(d.newListings) },
    { label: 'Months of Supply', value: d.monthsSupply.latest != null ? `${d.monthsSupply.latest.toFixed(1)} mo` : '—', tone: toneLow(d.monthsSupply.latest, 4, 3), points: spark(d.monthsSupply.obs), ...hist(d.monthsSupply.obs), ...alertBelow(d.monthsSupply.latest, 3, ' mo'), sub: subYoY(d.monthsSupply) },
    { label: 'Housing Starts', value: fThou(d.housingStarts.latest), points: spark(d.housingStarts.obs), ...hist(d.housingStarts.obs), sub: subYoY(d.housingStarts) },
    { label: 'Building Permits', value: fThou(d.permits.latest), points: spark(d.permits.obs), ...hist(d.permits.obs), sub: subYoY(d.permits) },
  ]
  return { key: 'supply', label: 'Supply', status, tone, signals, metrics }
}

function scoreDemand(d: HousingData): Omit<Category, 'fill'> {
  const signals: string[] = []
  let score = 0
  score += sig(d.existingSales.yoyPct != null && d.existingSales.yoyPct >= 3, true)
  score += sig(d.existingSales.yoyPct != null && d.existingSales.yoyPct <= -3, false)
  if (d.existingSales.yoyPct != null) signals.push(`Existing home sales ${d.existingSales.yoyPct >= 0 ? '+' : ''}${d.existingSales.yoyPct}% YoY`)
  score += sig(d.newSales.yoyPct != null && d.newSales.yoyPct >= 3, true)
  score += sig(d.newSales.yoyPct != null && d.newSales.yoyPct <= -3, false)
  if (d.newSales.yoyPct != null) signals.push(`New home sales ${d.newSales.yoyPct >= 0 ? '+' : ''}${d.newSales.yoyPct}% YoY`)
  const status = score >= 2 ? 'Strong' : score <= -2 ? 'Weakening' : 'Stable'
  const tone: Tone = status === 'Weakening' ? 'warn' : 'good' // Strong & Stable both green
  const metrics: MetricCard[] = [
    { label: 'Existing Home Sales', value: fCount(d.existingSales.latest), points: spark(d.existingSales.obs), ...hist(d.existingSales.obs), sub: subYoY(d.existingSales) },
    { label: 'New Home Sales', value: fThou(d.newSales.latest), points: spark(d.newSales.obs), ...hist(d.newSales.obs), sub: subYoY(d.newSales) },
  ]
  return { key: 'demand', label: 'Demand', status, tone, signals, metrics }
}

function scoreHeat(d: HousingData): Omit<Category, 'fill'> {
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
  // Hot & Balanced both green; Cooling orange; Frozen red
  const tone: Tone = status === 'Frozen' ? 'bad' : status === 'Cooling' ? 'warn' : 'good'
  const metrics: MetricCard[] = [
    { label: 'Days on Market', value: d.daysOnMarket.latest != null ? `${Math.round(d.daysOnMarket.latest)} days` : '—', points: spark(d.daysOnMarket.obs), ...hist(d.daysOnMarket.obs), sub: subYoY(d.daysOnMarket) },
    { label: 'Price-Cut Share', value: d.priceCutShare.latest != null ? `${d.priceCutShare.latest}%` : '—', sub: d.priceCutShare.yearAgo != null ? `${d.priceCutShare.yearAgo}% yr ago` : undefined },
  ]
  return { key: 'heat', label: 'Market Heat', status, tone, signals, metrics }
}

function scoreStress(d: HousingData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const mYoY = d.mortgageDelinq.yoyPct
  const cYoY = d.ccDelinq.yoyPct
  const mLevel = d.mortgageDelinq.latest
  if (mLevel != null) signals.push(`Mortgage delinquencies at ${mLevel}%${mYoY != null ? ` (${mYoY >= 0 ? '+' : ''}${mYoY}% YoY)` : ''}`)
  if (d.ccDelinq.latest != null) signals.push(`Card delinquencies at ${d.ccDelinq.latest}%${cYoY != null ? ` (${cYoY >= 0 ? '+' : ''}${cYoY}% YoY)` : ''}`)
  if (d.debtService.latest != null) signals.push(`Household debt service at ${d.debtService.latest.toFixed(1)}% of income`)
  let status: string = 'Low'
  if ((mYoY != null && mYoY >= 30) || (mLevel != null && mLevel >= 5)) status = 'Stressed'
  else if ((mYoY != null && mYoY >= 10) || (cYoY != null && cYoY >= 10)) status = 'Elevated'
  const tone: Tone = status === 'Stressed' ? 'bad' : status === 'Elevated' ? 'warn' : 'good' // Low = green
  const metrics: MetricCard[] = [
    { label: 'Mortgage Delinquency', value: fPct(d.mortgageDelinq.latest), unit: '%', tone: toneHigh(d.mortgageDelinq.latest, 3, 5), points: spark(d.mortgageDelinq.obs), ...hist(d.mortgageDelinq.obs), sub: subYoY(d.mortgageDelinq) },
    { label: 'Card Delinquency', value: fPct(d.ccDelinq.latest), unit: '%', tone: toneHigh(d.ccDelinq.latest, 3.5, 5), points: spark(d.ccDelinq.obs), ...hist(d.ccDelinq.obs), sub: subYoY(d.ccDelinq) },
    { label: 'Debt Service Ratio', value: d.debtService.latest != null ? `${d.debtService.latest.toFixed(1)}%` : '—', unit: '%', tone: toneHigh(d.debtService.latest, 11, 13), points: spark(d.debtService.obs), ...hist(d.debtService.obs), sub: 'of income' },
  ]
  return { key: 'stress', label: 'Financial Stress', status, tone, signals, metrics }
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
  if ((aff === 'Deteriorating' || aff === 'Pressured') && dem !== 'Strong') return { emoji: '🟠', label: 'Affordability Crunch', tone: 'warn' }
  if (heat === 'Cooling' || dem === 'Weakening' || sup === 'Tight')
    return { emoji: '🟠', label: 'Recovery Cooling', tone: 'warn' }
  if (aff === 'Improving' && dem === 'Strong') return { emoji: '🟢', label: 'Healthy Expansion', tone: 'good' }
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
export type WatchItem = { label: string; text: string; proximity: number; key: string } // 0..1, 1 = at threshold

function buildWatching(d: HousingData, alerts: HousingAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []

  const rate = d.mortgage30.latest
  if (rate != null && !firing.has('mortgage-7') && !firing.has('mortgage-8')) {
    const dist = parseFloat((7 - rate).toFixed(2))
    items.push({ label: 'Mortgage rates', text: `${dist}pp below the 7% alert`, proximity: Math.max(0, Math.min(1, rate / 7)), key: 'affordability' })
  } else if (rate != null && firing.has('mortgage-7') && !firing.has('mortgage-8')) {
    const dist = parseFloat((8 - rate).toFixed(2))
    items.push({ label: 'Mortgage rates', text: `${dist}pp below the 8% alert`, proximity: Math.max(0, Math.min(1, rate / 8)), key: 'affordability' })
  }

  if (d.monthsSupply.latest != null && !firing.has('supply-tight')) {
    const v = d.monthsSupply.latest
    items.push({ label: 'Months of supply', text: `${parseFloat((v - 3).toFixed(1))} months above the tight-supply alert (3.0)`, proximity: Math.max(0, Math.min(1, 3 / v)), key: 'supply' })
  }

  if (d.existingSales.yoyPct != null && !firing.has('sales-drop')) {
    const v = d.existingSales.yoyPct
    items.push({ label: 'Existing home sales', text: `${parseFloat((v + 10).toFixed(1))}pp above the −10% YoY alert`, proximity: Math.max(0, Math.min(1, v <= 0 ? Math.abs(v) / 10 : 0)), key: 'demand' })
  }

  if (d.mortgageDelinq.yoyPct != null && !firing.has('delinq-spike')) {
    const v = d.mortgageDelinq.yoyPct
    items.push({ label: 'Mortgage delinquencies', text: `${parseFloat((20 - v).toFixed(1))}pp below the +20% YoY alert`, proximity: Math.max(0, Math.min(1, v > 0 ? v / 20 : 0)), key: 'stress' })
  }

  return items.sort((a, b) => b.proximity - a.proximity)
}

// ── Biggest risk / biggest stabilizer ─────────────────────────────────
const RISK_PHRASE: Record<string, string> = {
  'affordability:Deteriorating': 'Affordability deteriorating — rates and prices keep outpacing wages.',
  'affordability:Pressured': 'Stretched affordability is holding buyers back.',
  'supply:Tight': 'Tightening inventory is pushing prices up.',
  'demand:Weakening': 'Buyer demand is pulling back.',
  'heat:Cooling': 'The market is cooling — homes are sitting longer.',
  'heat:Frozen': 'Sales activity is freezing up.',
  'stress:Elevated': 'Mortgage delinquencies are creeping higher.',
  'stress:Stressed': 'Household financial stress is rising.',
}
const STABILIZER_PHRASE: Record<string, string> = {
  'stress:Low': 'Low delinquencies — household balance sheets are healthy.',
  'demand:Strong': 'Strong buyer demand.',
  'demand:Stable': 'Steady buyer demand.',
  'supply:Expanding': 'Growing inventory is easing competition.',
  'supply:Healthy': 'Adequate for-sale inventory.',
  'heat:Hot': 'A brisk sales pace.',
  'heat:Balanced': 'Balanced negotiating conditions.',
  'affordability:Improving': 'Affordability is improving.',
}
const TONE_RANK: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3 }
// Preference order when several categories tie as the top stabilizer
const STABILIZER_PREF = ['stress', 'demand', 'supply', 'heat', 'affordability']

// Plain-English "why this matters" for un-initiated readers, per theme.
const RISK_WHY: Record<string, string> = {
  affordability: 'When homes cost more relative to incomes, fewer people can afford to buy — sidelining buyers and eventually cooling prices.',
  supply: 'Too few homes for sale forces buyers to compete and bids prices up, worsening affordability.',
  demand: 'When buyers step back, sales slow and home prices soften — and construction and related jobs follow.',
  heat: 'A cooling market means homes sit longer and sellers cut prices, a sign demand is fading.',
  stress: 'Rising mortgage delinquencies are an early warning that households are struggling — and can feed into foreclosures.',
}
const STAB_WHY: Record<string, string> = {
  affordability: 'Improving affordability brings buyers back and supports a healthy market.',
  supply: 'Healthy inventory eases bidding wars and keeps prices in check.',
  demand: 'Steady buyer demand keeps sales and construction activity flowing.',
  heat: 'A balanced market means fair conditions for both buyers and sellers.',
  stress: 'Low delinquencies mean household balance sheets are healthy and foreclosure risk is contained.',
}

export type Callout = { text: string; why: string; key: string }

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: Callout; stabilizer: Callout } {
  const worst = [...cats].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone])[0]
  const useWatch = !(worst && TONE_RANK[worst.tone] >= 2)
  const riskText = !useWatch
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label} is under pressure.`)
    : watching[0]
      ? `${watching[0].label} approaching its alert — ${watching[0].text}.`
      : 'No major risks building right now.'
  const riskKey = useWatch ? (watching[0]?.key ?? worst?.key ?? '') : worst.key

  const goods = cats.filter(c => c.tone === 'good')
  const pool = goods.length ? goods : [...cats].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
  const best = pool.sort((a, b) => STABILIZER_PREF.indexOf(a.key) - STABILIZER_PREF.indexOf(b.key))[0]
  const stabText = best
    ? (STABILIZER_PHRASE[`${best.key}:${best.status}`] ?? `${best.label} is holding steady.`)
    : 'No clear stabilizers right now.'
  return {
    risk: { text: riskText, why: RISK_WHY[riskKey] ?? '', key: riskKey },
    stabilizer: { text: stabText, why: STAB_WHY[best?.key] ?? '', key: best?.key ?? '' },
  }
}

// Most recent housing alert event (for "Last alert" when none are active).
// Uses the 30Y rate crossing 7% — the headline housing alert with weekly history.
function buildLastAlert(d: HousingData): string | null {
  for (const o of d.mortgage30.history) {
    if (o.value >= 7) {
      const when = new Date(o.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      return `Mortgage rates above 7% — last seen ${when}.`
    }
  }
  return null
}

// ── Public entry point ────────────────────────────────────────────────
export type HousingModel = {
  available: boolean      // false when core FRED series are missing (rate-limited / down)
  status: HousingStatus
  subtitle: string        // one-line plain-English explanation of the status
  risk: Callout           // biggest risk callout (text + why + driver key)
  stabilizer: Callout     // biggest stabilizer callout
  categories: Category[]
  alerts: HousingAlert[]
  lastAlert: string | null
  watching: WatchItem[]
  data: HousingData
}

const SUBTITLES: Record<string, string> = {
  'Healthy Expansion': 'Sales and construction are rising with affordability intact.',
  'Balanced Market': 'Supply and demand remain in equilibrium.',
  'Recovery Cooling': 'Sales are weakening under elevated mortgage rates.',
  'Affordability Crunch': 'Home prices and rates continue to outpace wages.',
  'Demand Shock': 'Buyers are pulling back sharply across the market.',
  'Financial Stress': 'Mortgage delinquencies are climbing toward danger.',
  'Housing Correction': 'Multiple parts of the market are breaking down at once.',
  'Data Unavailable': 'Live housing data is temporarily unavailable.',
}

export async function buildHousingModel(): Promise<HousingModel> {
  const data = await fetchHousingData()

  // Data-unavailable guard: the 30Y rate is the keystone series. If it's
  // missing (FRED rate-limited or down), don't fabricate a reassuring status.
  if (data.mortgage30.latest == null) {
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      risk: { text: '', why: '', key: '' }, stabilizer: { text: '', why: '', key: '' },
      categories: [], alerts: [], lastAlert: null, watching: [], data,
    }
  }

  const categories = [
    scoreAffordability(data),
    scoreSupply(data),
    scoreDemand(data),
    scoreHeat(data),
    scoreStress(data),
  ].map(withFill)
  const byKey = Object.fromEntries(categories.map(c => [c.key, c]))
  const status = overallStatus(byKey as Record<string, Category>)
  const alerts = buildAlerts(data)
  const watching = buildWatching(data, alerts)
  const { risk, stabilizer } = riskAndStabilizer(categories, watching)
  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    risk, stabilizer,
    categories, alerts,
    lastAlert: buildLastAlert(data),
    watching, data,
  }
}
