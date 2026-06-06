// lib/thresholds.ts
// Edit these values to change your alert triggers

export type Indicator = {
  key: string
  label: string
  unit: string
  unitPosition: 'prefix' | 'suffix'
  alertAbove?: number
  alertBelow?: number
  warnBuffer?: number // % within threshold to show warning (0.1 = 10%)
  description: string
}

export const INDICATORS: Indicator[] = [
  {
    key: 'vix',
    label: 'VIX',
    unit: '',
    unitPosition: 'suffix',
    alertAbove: 35,
    warnBuffer: 0.15,
    description: 'CBOE Volatility Index — fear gauge',
  },
  {
    key: 'treasury10y',
    label: '10Y Treasury',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 5.5,
    warnBuffer: 0.05,
    description: '10-year US Treasury yield',
  },
  {
    key: 'fedfunds',
    label: 'Fed Funds',
    unit: '%',
    unitPosition: 'suffix',
    description: 'Federal Funds effective rate',
  },
  {
    key: 'cpi',
    label: 'CPI (YoY)',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 4.0,
    warnBuffer: 0.1,
    description: 'Consumer Price Index, year-over-year',
  },
  {
    key: 'joblessClaims',
    label: 'Jobless Claims',
    unit: 'k',
    unitPosition: 'suffix',
    alertAbove: 280,
    warnBuffer: 0.1,
    description: 'Initial jobless claims (thousands)',
  },
  {
    key: 'yieldCurve',
    label: '2Y–10Y Spread',
    unit: '%',
    unitPosition: 'suffix',
    alertBelow: -0.5,
    warnBuffer: 0.2,
    description: 'Yield curve: 10Y minus 2Y (negative = inverted)',
  },
  {
    key: 'hySpread',
    label: 'HY Bond Spread',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 6.0,
    warnBuffer: 0.15,
    description: 'High yield bond spread over Treasuries',
  },
  {
    key: 'igSpread',
    label: 'IG Credit Spread',
    unit: '%',
    unitPosition: 'suffix',
    alertAbove: 2.0,
    warnBuffer: 0.15,
    description: 'Investment grade credit spread — early stress signal',
  },
  {
    key: 'sp500',
    label: 'S&P 500',
    unit: '',
    unitPosition: 'prefix',
    description: 'S&P 500 index — alerts on 10% drawdown from recent high',
  },
]

export type AlertStatus = 'ok' | 'warn' | 'alert'

export function getStatus(indicator: Indicator, value: number): AlertStatus {
  const { alertAbove, alertBelow, warnBuffer = 0.1 } = indicator

  if (alertAbove !== undefined) {
    if (value >= alertAbove) return 'alert'
    if (value >= alertAbove * (1 - warnBuffer)) return 'warn'
  }

  if (alertBelow !== undefined) {
    if (value <= alertBelow) return 'alert'
    if (value <= alertBelow * (1 - warnBuffer)) return 'warn'
  }

  return 'ok'
}
