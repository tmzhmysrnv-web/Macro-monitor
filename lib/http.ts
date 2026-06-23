// lib/http.ts
// Small request helpers shared by the API routes: the caller's IP (for rate
// limiting) and a same-origin check (CSRF defense-in-depth on cookie-authed
// mutations). Domain-agnostic — compares the request's Origin/Referer host to
// its own Host header, so it works on the prod domain and Vercel previews alike.
import type { NextApiRequest, NextApiResponse } from 'next'
import { timingSafeEqual } from 'crypto'

// Edge-cache GOOD data responses, but NEVER cache an unavailable/empty one.
// Otherwise a single FRED rate-limit blip gets cached at Vercel's edge for the
// full TTL and served to everyone until it expires (the "loaded at first, then
// stuck on 'temporarily unavailable'" bug). On not-ok, no-store forces the next
// request to re-fetch — which usually succeeds once FRED's per-minute window clears.
export function cacheData(res: NextApiResponse, ok: boolean, sMaxAge: number, swr = 3600): void {
  if (ok) res.setHeader('Cache-Control', `s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`)
  else res.setHeader('Cache-Control', 'no-store, must-revalidate')
}

// Constant-time check of the `Authorization: Bearer <CRON_SECRET>` header used by
// the cron / weekly-digest / admin routes (avoids leaking the secret via timing).
export function validCronAuth(req: NextApiRequest): boolean {
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  const got = req.headers.authorization || ''
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function clientIp(req: NextApiRequest): string {
  const xff = req.headers['x-forwarded-for']
  const raw = Array.isArray(xff) ? xff[0] : xff
  if (raw) return raw.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

// True when the request's Origin (or Referer) matches its Host. A cross-site
// form POST won't match; a same-site fetch will. Missing Origin AND Referer on a
// state-changing request is treated as untrusted (returns false).
export function sameOrigin(req: NextApiRequest): boolean {
  const host = req.headers.host
  if (!host) return false
  const src = req.headers.origin || req.headers.referer
  if (!src) return false
  try {
    return new URL(src).host === host
  } catch {
    return false
  }
}
