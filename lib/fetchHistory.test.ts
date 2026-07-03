import { describe, expect, it } from 'vitest'
import { HISTORY_KEYS, downsampleSeries, isHistoryKey, type DataPoint } from './fetchHistory'

describe('history key registry', () => {
  it('recognizes the indicator keys used by cards and watchlists', () => {
    expect(isHistoryKey('cpi')).toBe(true)
    expect(isHistoryKey('oil')).toBe(true)
    expect(isHistoryKey('sp500')).toBe(true)
    expect(isHistoryKey('not-real')).toBe(false)
  })

  it('keeps the full history map surface populated', () => {
    expect(HISTORY_KEYS).toContain('vix')
    expect(HISTORY_KEYS).toContain('yieldCurve')
    expect(HISTORY_KEYS).toContain('russell2000')
  })
})

describe('downsampleSeries', () => {
  it('returns compact recent points for dashboard sparklines', () => {
    const series: DataPoint[] = Array.from({ length: 120 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: i,
    }))

    const sampled = downsampleSeries(series, 40)

    expect(sampled.length).toBeLessThanOrEqual(40)
    expect(sampled.at(-1)?.value).toBeGreaterThanOrEqual(80)
  })

  it('does not modify already-small series', () => {
    const series: DataPoint[] = [{ date: '2026-01-01', value: 1 }]
    expect(downsampleSeries(series, 40)).toBe(series)
  })
})
