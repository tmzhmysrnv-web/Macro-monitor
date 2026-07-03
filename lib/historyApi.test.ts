import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextApiRequest, NextApiResponse } from 'next'

vi.mock('./fetchHistory', () => ({
  downsampleSeries: vi.fn((series, maxPoints) => series.slice(-maxPoints)),
  fetchHistoryByKey: vi.fn(),
  fetchHistoryForKeys: vi.fn(),
  isHistoryKey: vi.fn((key: string) => ['cpi', 'oil', 'sp500'].includes(key)),
}))

import { fetchHistoryByKey, fetchHistoryForKeys } from './fetchHistory'
import handler from '../pages/api/history'

function req(query: Record<string, string> = {}, method = 'GET'): NextApiRequest {
  return { method, query } as NextApiRequest
}

function res() {
  const response = {
    body: undefined as unknown,
    code: 200,
    headers: {} as Record<string, string>,
    end: vi.fn(),
    json: vi.fn(function json(this: typeof response, body: unknown) {
      this.body = body
      return this
    }),
    setHeader: vi.fn(function setHeader(this: typeof response, key: string, value: string) {
      this.headers[key] = value
      return this
    }),
    status: vi.fn(function status(this: typeof response, code: number) {
      this.code = code
      return this
    }),
  }
  return response as unknown as NextApiResponse & typeof response
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('/api/history', () => {
  it('preserves single-key response compatibility', async () => {
    vi.mocked(fetchHistoryByKey).mockResolvedValue([{ date: '2026-01-01', value: 2 }])
    const response = res()

    await handler(req({ key: 'cpi' }), response)

    expect(fetchHistoryByKey).toHaveBeenCalledWith('cpi')
    expect(response.code).toBe(200)
    expect(response.body).toEqual({ key: 'cpi', series: [{ date: '2026-01-01', value: 2 }] })
  })

  it('rejects unknown single keys', async () => {
    const response = res()

    await handler(req({ key: 'bad' }), response)

    expect(fetchHistoryByKey).not.toHaveBeenCalled()
    expect(response.code).toBe(404)
    expect(response.body).toEqual({ error: 'Unknown indicator' })
  })

  it('returns batched sparkline series for valid keys', async () => {
    const longSeries = Array.from({ length: 50 }, (_, i) => ({ date: `2026-01-${i + 1}`, value: i }))
    vi.mocked(fetchHistoryForKeys).mockResolvedValue({ cpi: longSeries, oil: longSeries })
    const response = res()

    await handler(req({ keys: 'cpi,oil', mode: 'sparkline' }), response)

    expect(fetchHistoryForKeys).toHaveBeenCalledWith(['cpi', 'oil'])
    expect(response.code).toBe(200)
    expect(response.body).toEqual({
      keys: ['cpi', 'oil'],
      series: {
        cpi: longSeries.slice(-40),
        oil: longSeries.slice(-40),
      },
    })
  })

  it('rejects unknown batch keys before fetching', async () => {
    const response = res()

    await handler(req({ keys: 'cpi,bad', mode: 'sparkline' }), response)

    expect(fetchHistoryForKeys).not.toHaveBeenCalled()
    expect(response.code).toBe(400)
    expect(response.body).toEqual({ error: 'Unknown indicator', keys: ['bad'] })
  })
})
