// lib/http.ts
// Small request helpers shared by the API routes: the caller's IP (for rate
// limiting) and a same-origin check (CSRF defense-in-depth on cookie-authed
// mutations). Domain-agnostic — compares the request's Origin/Referer host to
// its own Host header, so it works on the prod domain and Vercel previews alike.
import type { NextApiRequest } from 'next'

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
