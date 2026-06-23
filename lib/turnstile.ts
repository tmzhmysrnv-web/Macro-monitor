// lib/turnstile.ts
// Cloudflare Turnstile (CAPTCHA) verification for the subscribe endpoint.
// Gated by env: when TURNSTILE_SECRET_KEY is unset the check is skipped (so the
// app still runs before Turnstile is configured); once set, a valid token is
// REQUIRED. Pair with NEXT_PUBLIC_TURNSTILE_SITE_KEY on any signup form that
// renders the widget and sends `turnstileToken` in the POST body.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function turnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY
}

export async function verifyTurnstile(
  token: string | undefined | null,
  ip?: string,
): Promise<{ ok: boolean; skipped?: boolean }> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: true, skipped: true } // not configured → don't block
  if (!token) return { ok: false }
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip && ip !== 'unknown') body.set('remoteip', ip)
    const res = await fetch(VERIFY_URL, { method: 'POST', body })
    if (!res.ok) return { ok: false }
    const data = (await res.json()) as { success?: boolean }
    return { ok: !!data.success }
  } catch {
    return { ok: false }
  }
}
