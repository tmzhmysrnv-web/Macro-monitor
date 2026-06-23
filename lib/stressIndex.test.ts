import { describe, it, expect } from 'vitest'
import { computeStressIndex } from './stressIndex'
import type { MacroData } from './fetchData'

// Values are in the units the signals expect (jobless claims in thousands, etc.).
const calm = {
  vix: 14, hySpread: 3, igSpread: 1.2, treasury10y: 3.8, yieldCurve: 0.5,
  joblessClaims: 220, mortgage30: 5, homePriceYoY: 4, cpi: 2.5,
} as MacroData

const breaking = {
  vix: 60, hySpread: 12, igSpread: 5, treasury10y: 7.5, yieldCurve: -2,
  joblessClaims: 600, mortgage30: 10, homePriceYoY: -15, cpi: 10,
} as MacroData

describe('computeStressIndex', () => {
  it('scores calm inputs low and breaking inputs high (and never inverts)', () => {
    const c = computeStressIndex(calm)
    const b = computeStressIndex(breaking)
    expect(c.total).toBeLessThan(40)
    expect(b.total).toBeGreaterThan(65)
    expect(b.total).toBeGreaterThan(c.total)
  })

  it('returns a total in 0–100 and per-subsystem categories', () => {
    const r = computeStressIndex(calm)
    expect(r.total).toBeGreaterThanOrEqual(0)
    expect(r.total).toBeLessThanOrEqual(100)
    expect(Array.isArray(r.categories)).toBe(true)
  })
})
