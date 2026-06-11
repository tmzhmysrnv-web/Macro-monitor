// pages/api/stress.ts
// Computes the current stress index and returns it with recent history.
// History is stored as daily snapshots. Uses a simple file-free approach:
// snapshots are kept in module memory and optionally persisted to Vercel KV
// if configured (KV_REST_API_URL + KV_REST_API_TOKEN env vars).

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchAllData } from '../../lib/fetchData'
import { computeStressIndex } from '../../lib/stressIndex'

type Snapshot = { date: string; total: number }

// In-memory fallback store (resets on cold start)
let memoryHistory: Snapshot[] = []

// ── Optional Vercel KV persistence ───────────────────────────────────
const KV_URL = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN
const KV_KEY = 'stress_history'

async function kvGet(): Promise<Snapshot[] | null> {
  if (!KV_URL || !KV_TOKEN) return null
  try {
    const res = await fetch(`${KV_URL}/get/${KV_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.result ? JSON.parse(data.result) : []
  } catch { return null }
}

async function kvSet(history: Snapshot[]): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return
  try {
    await fetch(`${KV_URL}/set/${KV_KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(history)),
    })
  } catch { /* ignore */ }
}

async function loadHistory(): Promise<Snapshot[]> {
  const kv = await kvGet()
  if (kv != null) return kv
  return memoryHistory
}

async function saveSnapshot(snap: Snapshot): Promise<Snapshot[]> {
  let history = await loadHistory()
  // Replace today's entry if it exists, else append
  history = history.filter(s => s.date !== snap.date)
  history.push(snap)
  // Keep last 90 days
  history = history.sort((a, b) => a.date.localeCompare(b.date)).slice(-90)
  memoryHistory = history
  await kvSet(history)
  return history
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const data = await fetchAllData()
    const result = computeStressIndex(data)
    const today = new Date().toISOString().split('T')[0]

    // Record today's snapshot (POST from cron, or first GET of the day)
    let history = await loadHistory()
    const hasToday = history.some(s => s.date === today)
    if (!hasToday || req.method === 'POST') {
      history = await saveSnapshot({ date: today, total: result.total })
    }

    // Compute week-over-week change
    const todayVal = result.total
    const weekAgo = history.find(s => {
      const d = new Date(s.date)
      const diff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)
      return diff >= 6 && diff <= 8
    })
    const weekChange = weekAgo ? todayVal - weekAgo.total : null

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      ...result,
      weekChange,
      history: history.map(s => ({ date: s.date, total: s.total })),
    })
  } catch (err) {
    console.error('Stress index error:', err)
    res.status(500).json({ error: 'Failed to compute stress index' })
  }
}
