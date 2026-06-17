// lib/thresholds.ts — single source of truth for alert thresholds + historical context

export type Indicator = {
  key: string
  label: string
  unit: string
  unitPosition: 'prefix' | 'suffix'
  alertAbove?: number
  alertBelow?: number
  warnBuffer?: number
  description: string
  // Historical percentile range for "normal" vs "opportunity" vs "danger"
  // [histMin, histLow10, histMedian, histHigh90, histMax] — approximate 30yr ranges
  history?: [number, number, number, number, number]
  // Direction: 'low-good' = low values are opportunities (rates, spreads)
  //            'high-good' = high values are opportunities (copper, stocks)
  //            'neutral'   = neither direction is inherently good
  opportunityDirection?: 'low-good' | 'high-good' | 'neutral'
}

export const INDICATORS: Indicator[] = [
  {
    key: 'vix',
    label: 'VIX',
    unit: '',
    unitPosition: 'suffix',
    alertAbove: 35,
    warnBuffer: 0.15,
    description: 'CBOE Volatility Index — market fear gauge',
    history: [9, 12, 17, 28, 82],
    opportunityDirection: 'low-good',
  },
  {
    key: 'treasury10y',
    label: '10Y Treasury',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 5.5,
    warnBuffer: 0.05,
    description: '10-year US Treasury yield',
    history: [0.5, 1.5, 3.5, 5.0, 8.0],
    opportunityDirection: 'low-good',
  },
  {
    key: 'fedfunds',
    label: 'Fed Funds',
    unit: '%',
    unitPosition: 'suffix',
    description: 'Federal Funds effective rate',
    history: [0.07, 0.25, 2.5, 5.25, 6.5],
    opportunityDirection: 'low-good',
  },
  {
    key: 'cpi',
    label: 'CPI (YoY)',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 4.0,
    warnBuffer: 0.1,
    description: 'Consumer Price Index, year-over-year',
    history: [-0.4, 1.0, 2.4, 4.5, 9.1],
    opportunityDirection: 'low-good',
  },
  {
    key: 'joblessClaims',
    label: 'Jobless Claims',
    unit: 'k',
    unitPosition: 'suffix',
    alertAbove: 280,
    warnBuffer: 0.1,
    description: 'Initial jobless claims (thousands)',
    history: [166, 195, 230, 290, 695],
    opportunityDirection: 'low-good',
  },
  {
    key: 'yieldCurve',
    label: '2Y–10Y Spread',
    unit: '%',
    unitPosition: 'suffix',
    alertBelow: -0.5,
    warnBuffer: 0.2,
    description: 'Yield curve: 10Y minus 2Y. Negative = inverted = recession signal',
    history: [-1.1, -0.1, 0.9, 1.8, 2.9],
    opportunityDirection: 'high-good',
  },
  {
    key: 'hySpread',
    label: 'HY Bond Spread',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 6.0,
    warnBuffer: 0.15,
    description: 'High yield bond spread. Low = credit calm. High = stress or opportunity',
    history: [2.3, 3.0, 4.5, 7.0, 21.8],
    opportunityDirection: 'low-good',
  },
  {
    key: 'igSpread',
    label: 'IG Credit Spread',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 2.0,
    warnBuffer: 0.15,
    description: 'Investment grade credit spread — early stress signal',
    history: [0.5, 0.9, 1.4, 2.2, 6.1],
    opportunityDirection: 'low-good',
  },
  {
    key: 'sp500',
    label: 'S&P 500',
    unit: '',
    unitPosition: 'prefix',
    description: 'S&P 500 index',
    opportunityDirection: 'high-good',
  },
  {
    key: 'dxy',
    label: 'DXY',
    unit: '',
    unitPosition: 'suffix',
    alertAbove: 110,
    alertBelow: 90,
    warnBuffer: 0.05,
    description: 'US Dollar Index. Extreme strength or weakness can signal stress',
    history: [71, 90, 97, 104, 121],
    opportunityDirection: 'neutral',
  },
  {
    key: 'gold',
    label: 'Gold',
    unit: '$',
    unitPosition: 'prefix',
    description: 'Gold spot price. Rising gold = inflation fear or dollar distrust',
    opportunityDirection: 'neutral',
  },
  {
    key: 'oil',
    label: 'WTI Crude',
    unit: '$',
    unitPosition: 'prefix',
    alertAbove: 100,
    warnBuffer: 0.1,
    description: 'Oil price. Spikes feed directly into CPI',
    history: [11, 40, 65, 90, 145],
    opportunityDirection: 'neutral',
  },
  {
    key: 'copper',
    label: 'Copper',
    unit: '$',
    unitPosition: 'prefix',
    description: 'Copper price ($/lb) — Dr. Copper tracks global growth',
    history: [0.6, 2.0, 3.2, 4.2, 5.1],
    opportunityDirection: 'high-good',
  },
  {
    key: 'silver',
    label: 'Silver',
    unit: '$',
    unitPosition: 'prefix',
    description: 'Silver price ($/oz) — industrial + precious; the gold/silver ratio tracks growth vs fear',
    history: [12, 18, 24, 32, 50],
    opportunityDirection: 'high-good',
  },
  {
    key: 'mortgage30',
    label: '30Y Mortgage',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 8.0,
    warnBuffer: 0.1,
    description: '30-year fixed mortgage rate — housing affordability gauge',
    history: [2.65, 3.5, 5.0, 7.0, 8.5],
    opportunityDirection: 'low-good',
  },
  {
    key: 'treasury2y',
    label: '2Y Treasury',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 5.0,
    warnBuffer: 0.1,
    description: '2-year Treasury yield — the most rate-policy-sensitive point on the curve',
    history: [0.1, 1.0, 2.5, 4.5, 5.0],
    opportunityDirection: 'neutral',
  },
  {
    key: 'payrolls',
    label: 'Payrolls (NFP)',
    unit: 'k',
    unitPosition: 'suffix',
    alertBelow: 0,
    warnBuffer: 1,
    description: 'Non-farm payrolls — monthly job change; negative prints flag recession risk',
    history: [-800, 0, 150, 250, 500],
    opportunityDirection: 'high-good',
  },
  {
    key: 'homePriceYoY',
    label: 'Home Prices (YoY)',
    unit: '%',
    unitPosition: 'suffix',
    alertBelow: -5,
    warnBuffer: 1,
    description: 'Case-Shiller home prices, year-over-year — falling prices signal a housing downturn',
    history: [-12, -3, 3, 10, 20],
    opportunityDirection: 'high-good',
  },
]

export type AlertStatus = 'ok' | 'warn' | 'alert'
export type OpportunityStatus = 'opportunity' | 'favorable' | 'normal' | 'elevated' | 'extreme'

export function getStatus(indicator: Indicator, value: number): AlertStatus {
  const { alertAbove, alertBelow, warnBuffer = 0.1 } = indicator
  // Warn zone sits just on the safe side of the alert threshold, sized by
  // |threshold| * warnBuffer so it works for negative thresholds too
  // (e.g. yield curve alertBelow -0.5 warns at -0.4, not -0.6).
  if (alertAbove !== undefined) {
    if (value >= alertAbove) return 'alert'
    if (value >= alertAbove - Math.abs(alertAbove) * warnBuffer) return 'warn'
  }
  if (alertBelow !== undefined) {
    if (value <= alertBelow) return 'alert'
    if (value <= alertBelow + Math.abs(alertBelow) * warnBuffer) return 'warn'
  }
  return 'ok'
}

// Returns 0–100 percentile of value within historical range
export function getPercentile(indicator: Indicator, value: number): number | null {
  if (!indicator.history) return null
  const [min, , , , max] = indicator.history
  if (max === min) return 50
  return Math.round(Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)))
}

// Returns a human-readable context string for warn/alert states
export function getContextText(key: string, value: number, status: AlertStatus): string | null {
  if (status === 'ok') return null
  const contexts: Record<string, { warn: string; alert: string }> = {
    vix: {
      warn: 'Volatility is elevated — markets are pricing in uncertainty. Credit spread widening is worth monitoring.',
      alert: 'Fear is spiking. Historically, sustained VIX above 35 has coincided with significant market stress events.',
    },
    treasury10y: {
      warn: 'Yields approaching historically elevated territory. Borrowing costs across the economy are climbing.',
      alert: 'Yields at historically elevated levels. Fixed-rate borrowing costs are high across mortgages, auto, and corporate debt.',
    },
    cpi: {
      warn: 'Inflation reaccelerating toward 4%. The Fed\'s dual mandate is under pressure.',
      alert: 'Inflation above 4%. Purchasing power is eroding and the Fed faces difficult tradeoffs.',
    },
    joblessClaims: {
      warn: 'Claims ticking up. Early signal of labor market softening — worth monitoring for confirmation.',
      alert: 'Claims at elevated levels. Labor market conditions are deteriorating.',
    },
    yieldCurve: {
      warn: 'Curve deeply inverted. Historically, this pattern has preceded recessions by 12–18 months.',
      alert: 'Extreme inversion. This signal has preceded every US recession in the past 50 years.',
    },
    hySpread: {
      warn: 'High yield spreads widening — credit stress building in lower-rated corporate debt.',
      alert: 'HY spreads above 6%. Credit markets are pricing in elevated default risk.',
    },
    igSpread: {
      warn: 'IG spreads widening — credit stress signal appearing even in investment grade debt.',
      alert: 'IG spreads at elevated levels. Credit conditions are tightening broadly.',
    },
    oil: {
      warn: 'Oil approaching $100 — energy costs are feeding into broader inflation measures.',
      alert: 'Oil above $100. Historically, sustained prices at this level have coincided with recessions.',
    },
    dxy: {
      warn: value > 105
        ? 'Dollar strength at elevated levels — tightening global financial conditions and pressuring US exports.'
        : 'Dollar weakening — inflation expectations may be rising.',
      alert: value > 110
        ? 'Dollar at historically strong levels. Emerging market debt stress is elevated.'
        : 'Dollar at historically weak levels. Inflation risk is elevated.',
    },
  }
  return contexts[key]?.[status] ?? null
}

// Returns historical context when conditions are at notable extremes
export function getOpportunityText(key: string, percentile: number, value: number): string | null {
  if (percentile > 15) return null
  const notes: Record<string, string> = {
    fedfunds: `Fed Funds at ${value}% — in the bottom 15th percentile historically. Low-rate environments like this have been rare over the past 30 years.`,
    treasury10y: `10Y yield at ${value}% — near historic lows. Long-term borrowing costs are at a historically compressed level.`,
    hySpread: `HY spreads at ${value}% — historically tight. Credit markets are calm by historical standards.`,
    vix: `VIX at ${value} — historically low volatility. Markets have rarely been this calm over the past 30 years.`,
    joblessClaims: `Claims at ${value}k — labor market is historically strong by this measure.`,
  }
  return notes[key] ?? null
}
