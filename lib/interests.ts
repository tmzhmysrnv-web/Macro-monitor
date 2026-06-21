// lib/interests.ts
// Single source of truth for the personalized-dashboard interest catalog.
// Each interest maps to real metrics we already fetch + an existing intelligence
// tab, so the signed-in watchlist, onboarding, settings, and interest-filtered
// alerts all agree. Interests deliberately map to existing data only (no
// AI/Climate/Geopolitics — nothing to show or alert on there yet).
import { INDICATORS, getStatus, getContextText, type AlertStatus } from './thresholds'
import type { IconName } from '../components/Icon'

export type InterestCategory =
  | 'inflation' | 'jobs' | 'housing' | 'stocks' | 'rates' | 'recession' | 'dollar'

export type InterestDef = {
  category: InterestCategory
  label: string
  blurb: string          // shown on the onboarding selection card
  metrics: string[]      // indicator keys (must exist in INDICATORS)
  tab: string            // intelligence tab to deep-link into
  icon: IconName
  calm: string           // default "all quiet" insight line
}

export const INTEREST_CATALOG: InterestDef[] = [
  {
    category: 'inflation', label: 'Inflation', icon: 'flame', tab: 'inflation',
    blurb: 'Prices, CPI, and energy costs.',
    metrics: ['cpi', 'oil'],
    calm: 'No meaningful inflation shift detected. Prices remain near target levels.',
  },
  {
    category: 'jobs', label: 'Labor Market', icon: 'briefcase', tab: 'labor',
    blurb: 'Jobs, claims, and hiring strength.',
    metrics: ['joblessClaims', 'payrolls'],
    calm: 'The labor market remains steady. No signs of stress in jobs data.',
  },
  {
    category: 'housing', label: 'Housing', icon: 'home', tab: 'housing',
    blurb: 'Mortgage rates and home prices.',
    metrics: ['mortgage30', 'homePriceYoY'],
    calm: 'No structural changes detected. Housing remains constrained but stable.',
  },
  {
    category: 'stocks', label: 'Stock Market', icon: 'activity', tab: 'markets',
    blurb: 'Equities and market volatility.',
    metrics: ['sp500', 'vix'],
    calm: 'Markets are calm. Volatility sits within its normal range.',
  },
  {
    category: 'rates', label: 'Rates & Fed', icon: 'chart-line', tab: 'bonds',
    blurb: 'Treasury yields and Fed policy.',
    metrics: ['treasury10y', 'fedfunds', 'yieldCurve'],
    calm: 'Rates are holding steady. No abrupt moves in yields or policy.',
  },
  {
    category: 'recession', label: 'Recession Risk', icon: 'bank', tab: 'credit',
    blurb: 'Yield curve and credit stress.',
    metrics: ['yieldCurve', 'hySpread', 'igSpread'],
    calm: 'Recession signals are quiet. Credit conditions remain orderly.',
  },
  {
    category: 'dollar', label: 'Dollar & Commodities', icon: 'globe', tab: 'global',
    blurb: 'The dollar, gold, oil, and copper.',
    metrics: ['dxy', 'gold', 'silver', 'oil', 'copper'],
    calm: 'The dollar and commodities are stable. No flight-to-safety signal.',
  },
]

export const VALID_CATEGORIES = new Set(INTEREST_CATALOG.map(i => i.category))

export function interestByCategory(category: string): InterestDef | undefined {
  return INTEREST_CATALOG.find(i => i.category === category)
}

// Which interest categories an alert on a given intelligence tab belongs to.
// Used to filter each user's digest to the topics they follow. A few tabs feed
// more than one interest (bonds → rates + recession; credit → recession).
export const TAB_TO_CATEGORIES: Record<string, InterestCategory[]> = {
  inflation: ['inflation'],
  labor: ['jobs'],
  housing: ['housing'],
  markets: ['stocks'],
  bonds: ['rates', 'recession'],
  credit: ['recession'],
  global: ['dollar'],
}

const indicatorFor = (key: string) => INDICATORS.find(i => i.key === key)

// Status badge label per tone (calm phrasing — avoids alarming language).
const BADGE: Record<AlertStatus, string> = { ok: 'Stable', warn: 'Watching', alert: 'Breaking' }

export type InterestReading = {
  status: AlertStatus
  badge: string
  insight: string
}

// Derive an interest's overall status from the WORST of its metrics, plus a
// one-line insight (the worst metric's context when stressed, else the calm
// default). `values` is keyed by indicator key.
export function readInterest(
  def: InterestDef,
  values: Record<string, number | null>,
): InterestReading {
  let worst: AlertStatus = 'ok'
  let worstKey: string | null = null
  for (const key of def.metrics) {
    const ind = indicatorFor(key)
    const v = values[key]
    if (!ind || v == null) continue
    const s = getStatus(ind, v)
    if (s === 'alert' || (s === 'warn' && worst === 'ok')) {
      worst = s
      worstKey = key
    }
  }
  let insight = def.calm
  if (worstKey) {
    const v = values[worstKey]
    if (v != null) insight = getContextText(worstKey, v, worst) ?? def.calm
  }
  return { status: worst, badge: BADGE[worst], insight }
}
