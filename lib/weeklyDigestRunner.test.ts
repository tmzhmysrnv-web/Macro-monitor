import { describe, expect, it } from 'vitest'
import { isoWeekFromDateParts, newYorkDateParts, runWeeklyDigest, withTimeout } from './weeklyDigestRunner'

describe('weekly digest runner', () => {
  it('recognizes the daily cron time as Sunday in New York on digest day', () => {
    const parts = newYorkDateParts(new Date('2026-07-05T14:30:00Z'))
    expect(parts).toMatchObject({ year: 2026, month: 7, day: 5, dayOfWeek: 0 })
    expect(isoWeekFromDateParts(parts)).toBe('2026-W27')
  })

  it('skips normal sends when the daily cron runs on Monday', async () => {
    await expect(runWeeklyDigest({ now: new Date('2026-07-06T14:30:00Z') }))
      .resolves.toEqual({ skipped: 'not Sunday (ET)', etDay: 1 })
  })

  it('bounds slow dependencies instead of consuming the whole function window', async () => {
    await expect(withTimeout(new Promise(() => {}), 5, 'slow dependency'))
      .rejects.toThrow('slow dependency timed out after 5ms')
  })
})
