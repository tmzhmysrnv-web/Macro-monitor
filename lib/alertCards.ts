// lib/alertCards.ts
// Builds the rich "active alert" cards for the Overview — header, the value vs.
// threshold, why it matters, who it affects, and historical context. Derived
// from the SAME MacroData the top-bar uses, so the alert count can never
// disagree with the flashing pill.

import type { MacroData } from './fetchData'
import { INDICATORS, getStatus, getPercentile, getContextText } from './thresholds'

export type AffectedArea = { icon: string; label: string; desc: string }
export type AlertCard = {
  key: string
  name: string
  icon: string
  title: string            // e.g. "Oil crossed $100/barrel"
  current: string          // formatted current value
  threshold: string        // formatted threshold
  direction: 'Rising' | 'Cooling' | 'Persistent'
  triggered: string | null // human date the threshold was crossed, if known
  whyItMatters: string
  affectedAreas: AffectedArea[]
  historicalContext: string[]
  viewLabel: string        // "View Inflation card"
}

type Meta = {
  name: string
  icon: string
  suffix?: string          // appended to the title threshold, e.g. "/barrel"
  areas: AffectedArea[]
  context: (value: number, percentile: number | null) => string[]
}

function pctLine(percentile: number | null): string[] {
  if (percentile == null) return []
  return [`In the ${percentile}th percentile of its 30-year range.`]
}

const META: Record<string, Meta> = {
  cpi: {
    name: 'Inflation', icon: '📈',
    areas: [
      { icon: '🏠', label: 'Households', desc: 'Everyday costs rise faster than wages, eroding purchasing power.' },
      { icon: '🏛️', label: 'Federal Reserve', desc: 'Hotter inflation pressures the Fed to keep rates higher for longer.' },
      { icon: '📉', label: 'Bonds', desc: 'Real, inflation-adjusted yields fall, pressuring fixed income.' },
      { icon: '💵', label: 'Savings', desc: 'Cash loses value in real terms the longer inflation persists.' },
    ],
    context: (v, p) => [...pctLine(p), 'Above the Fed’s 2% target.'],
  },
  oil: {
    name: 'Oil', icon: '🛢️', suffix: '/barrel',
    areas: [
      { icon: '🏠', label: 'Housing', desc: 'Construction and transportation costs rise.' },
      { icon: '📈', label: 'Inflation', desc: 'Goods and services become more expensive.' },
      { icon: '✈️', label: 'Travel', desc: 'Fuel costs increase.' },
      { icon: '🏛️', label: 'Federal Reserve', desc: 'Higher inflation pressure may delay rate cuts.' },
    ],
    context: (v, p) => [...pctLine(p), 'Sustained prices above $100 have historically coincided with recessions.'],
  },
  vix: {
    name: 'Volatility', icon: '⚡',
    areas: [
      { icon: '📉', label: 'Equities', desc: 'Sharp price swings; risk assets tend to sell off.' },
      { icon: '💳', label: 'Credit', desc: 'Spreads widen as risk appetite drops.' },
      { icon: '🏦', label: 'Markets', desc: 'Liquidity thins and hedging costs rise.' },
    ],
    context: (v, p) => [...pctLine(p), 'Sustained readings above 35 mark significant stress events.'],
  },
  treasury10y: {
    name: '10Y Treasury', icon: '🏦',
    areas: [
      { icon: '🏠', label: 'Mortgages', desc: 'Home-loan rates track the 10-year; affordability worsens.' },
      { icon: '🏢', label: 'Corporates', desc: 'Borrowing costs rise across investment-grade debt.' },
      { icon: '🏛️', label: 'Government', desc: 'Higher interest expense on the national debt.' },
      { icon: '📉', label: 'Equities', desc: 'Higher discount rates pressure valuations.' },
    ],
    context: (v, p) => [...pctLine(p), 'Among the higher yields of the past two decades.'],
  },
  mortgage30: {
    name: '30Y Mortgage', icon: '🏠',
    areas: [
      { icon: '🏠', label: 'Housing', desc: 'Monthly payments jump; affordability collapses.' },
      { icon: '🏗️', label: 'Construction', desc: 'New-build demand cools as financing costs rise.' },
      { icon: '🏦', label: 'Lenders', desc: 'Refinancing and origination volumes fall.' },
    ],
    context: (v, p) => [...pctLine(p), 'Among the highest affordability pressure in decades.'],
  },
  hySpread: {
    name: 'High-Yield Spreads', icon: '💳',
    areas: [
      { icon: '🏢', label: 'Corporates', desc: 'Riskier borrowers face sharply higher funding costs.' },
      { icon: '📉', label: 'Equities', desc: 'Widening spreads often precede equity stress.' },
      { icon: '🏦', label: 'Banks', desc: 'Loan losses rise and lending standards tighten.' },
    ],
    context: (v, p) => [...pctLine(p), 'Spreads above 6% signal elevated default risk.'],
  },
  igSpread: {
    name: 'IG Credit Spreads', icon: '💳',
    areas: [
      { icon: '🏢', label: 'Corporates', desc: 'Funding costs rise even for top-rated borrowers.' },
      { icon: '📉', label: 'Equities', desc: 'Stress in investment-grade debt often spreads to stocks.' },
      { icon: '🏦', label: 'Banks', desc: 'Credit conditions tighten broadly.' },
    ],
    context: (v, p) => [...pctLine(p), 'Stress appearing even in investment-grade debt.'],
  },
  joblessClaims: {
    name: 'Jobless Claims', icon: '👷',
    areas: [
      { icon: '👷', label: 'Workers', desc: 'Rising layoffs signal a softening job market.' },
      { icon: '🛍️', label: 'Consumer spending', desc: 'Income uncertainty curbs spending.' },
      { icon: '🏛️', label: 'Federal Reserve', desc: 'Labor weakness can pull rate cuts forward.' },
    ],
    context: (v, p) => [...pctLine(p), 'Claims at levels consistent with labor-market softening.'],
  },
  yieldCurve: {
    name: 'Yield Curve', icon: '📉',
    areas: [
      { icon: '🏦', label: 'Banks', desc: 'Inversion squeezes lending margins.' },
      { icon: '📉', label: 'Economy', desc: 'Historically precedes recessions by 12–18 months.' },
      { icon: '🏢', label: 'Corporates', desc: 'Short-term funding costs exceed long-term returns.' },
    ],
    context: (v, p) => ['This signal has preceded every US recession in the past 50 years.'],
  },
  dxy: {
    name: 'US Dollar', icon: '💵',
    areas: [
      { icon: '🌍', label: 'Emerging markets', desc: 'Dollar-denominated debt becomes harder to service.' },
      { icon: '🏭', label: 'US exporters', desc: 'Goods become less competitive abroad.' },
      { icon: '🛢️', label: 'Commodities', desc: 'A strong dollar pressures commodity prices.' },
    ],
    context: (v, p) => [...pctLine(p), 'Dollar at levels that tighten global financial conditions.'],
  },
}

function valueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper,
    mortgage30: data.mortgage30,
  }
  return map[key] ?? null
}

function fmtVal(key: string, v: number): string {
  if (key === 'sp500') return v.toLocaleString('en-US')
  if (key === 'gold') return `$${v.toLocaleString('en-US')}`
  if (key === 'oil') return `$${v.toFixed(2)}`
  if (key === 'copper') return `$${v.toFixed(3)}`
  if (key === 'joblessClaims') return `${v.toFixed(0)}k`
  if (key === 'dxy') return v.toFixed(2)
  if (key === 'vix') return v.toFixed(1)
  if (key === 'yieldCurve') return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
  if (['treasury10y', 'fedfunds', 'cpi', 'hySpread', 'igSpread', 'mortgage30'].includes(key)) return `${v.toFixed(2)}%`
  return v.toFixed(1)
}

type Extras = {
  directions?: Record<string, 'up' | 'down' | 'flat'> // from what-changed
  triggered?: Record<string, string>                  // from recent-breaks (ISO date)
}

export function buildAlertCards(data: MacroData, extras: Extras = {}): AlertCard[] {
  const cards: AlertCard[] = []
  for (const ind of INDICATORS) {
    const v = valueForKey(data, ind.key)
    if (v == null) continue
    if (getStatus(ind, v) !== 'alert') continue

    const meta = META[ind.key]
    const name = meta?.name ?? ind.label
    const crossedAbove = ind.alertAbove != null && v >= ind.alertAbove
    const threshold = crossedAbove ? ind.alertAbove! : (ind.alertBelow ?? ind.alertAbove ?? v)
    const thresholdStr = fmtVal(ind.key, threshold)
    const verb = crossedAbove ? 'crossed' : 'fell below'
    const title = `${name} ${verb} ${thresholdStr}${meta?.suffix ?? ''}`

    const dir = extras.directions?.[ind.key]
    const direction: AlertCard['direction'] = dir === 'up' ? 'Rising' : dir === 'down' ? 'Cooling' : 'Persistent'

    const iso = extras.triggered?.[ind.key]
    const triggered = iso
      ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null

    const percentile = getPercentile(ind, v)
    const whyItMatters = getContextText(ind.key, v, 'alert') || ind.description

    cards.push({
      key: ind.key,
      name,
      icon: meta?.icon ?? '⚠️',
      title,
      current: fmtVal(ind.key, v),
      threshold: thresholdStr,
      direction,
      triggered,
      whyItMatters,
      affectedAreas: meta?.areas ?? [],
      historicalContext: meta ? meta.context(v, percentile) : pctLine(percentile),
      viewLabel: `View ${name} card`,
    })
  }
  return cards
}
