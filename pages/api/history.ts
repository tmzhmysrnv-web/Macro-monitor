// pages/api/history.ts
// Returns historical time series for one indicator, or compact sparkline series
// for a batch of indicators.
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  downsampleSeries,
  fetchHistoryByKey,
  fetchHistoryForKeys,
  isHistoryKey,
  type DataPoint,
} from '../../lib/fetchHistory'

const SPARKLINE_POINTS = 40

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parseKeys(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : value
  return raw?.split(',').map(k => k.trim()).filter(Boolean) ?? []
}

function maybeSparkline(series: DataPoint[], mode: string | undefined): DataPoint[] {
  return mode === 'sparkline' ? downsampleSeries(series, SPARKLINE_POINTS) : series
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()
  const key = firstQueryValue(req.query.key)
  const keys = parseKeys(req.query.keys)
  const mode = firstQueryValue(req.query.mode)
  if (mode && mode !== 'sparkline') return res.status(400).json({ error: 'Unsupported history mode' })
  if (!key && keys.length === 0) return res.status(400).json({ error: 'key or keys required' })

  try {
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600')

    if (keys.length > 0) {
      const unique = Array.from(new Set(keys))
      const unknown = unique.filter(k => !isHistoryKey(k))
      if (unknown.length > 0) return res.status(400).json({ error: 'Unknown indicator', keys: unknown })
      const all = await fetchHistoryForKeys(unique)
      const series = Object.fromEntries(
        Object.entries(all).map(([k, s]) => [k, maybeSparkline(s, mode)]),
      )
      return res.status(200).json({ keys: unique, series })
    }

    if (!key || !isHistoryKey(key)) return res.status(404).json({ error: 'Unknown indicator' })
    const series = await fetchHistoryByKey(key)
    if (!series) return res.status(404).json({ error: 'Unknown indicator' })
    res.status(200).json({ key, series: maybeSparkline(series, mode) })
  } catch (err) {
    console.error('History fetch error:', err)
    res.status(500).json({ error: 'Failed to fetch history' })
  }
}
