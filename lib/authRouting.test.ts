import { describe, expect, it, vi } from 'vitest'
import { destinationAfterSignIn } from './authRouting'

function supabaseWithInterestCount(count: number | null, error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ count, error })
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, from, select, eq }
}

describe('destinationAfterSignIn', () => {
  it('routes returning users with interests to the dashboard', async () => {
    const s = supabaseWithInterestCount(2)

    await expect(destinationAfterSignIn(s.client as never, 'user-1')).resolves.toBe('/dashboard')
    expect(s.from).toHaveBeenCalledWith('user_interests')
    expect(s.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('routes new users without interests to onboarding', async () => {
    const s = supabaseWithInterestCount(0)

    await expect(destinationAfterSignIn(s.client as never, 'user-1')).resolves.toBe('/onboarding')
  })

  it('falls back to the dashboard when the interests check fails', async () => {
    const s = supabaseWithInterestCount(null, new Error('nope'))

    await expect(destinationAfterSignIn(s.client as never, 'user-1')).resolves.toBe('/dashboard')
  })
})
