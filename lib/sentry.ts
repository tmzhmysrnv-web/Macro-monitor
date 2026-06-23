// lib/sentry.ts
// Lightweight SERVER-side error reporting (audit: error monitoring). Uses
// @sentry/node directly — NO @sentry/nextjs build plugin, so the Turbopack build
// is untouched. Fully no-op until a DSN is set, so it ships safely before the
// Sentry project exists. Errors only: tracesSampleRate 0 means no performance
// spans and no replays, which keeps usage well inside Sentry's free tier.
//
// Server-only — import this from API routes / server code, never from a client
// component (that would pull @sentry/node into the browser bundle).
import * as Sentry from '@sentry/node'

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (DSN) {
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: 0,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA, // auto-set by Vercel
  })
}

// Report a server-side error (no-op without a DSN). Awaits flush because Vercel
// can freeze the serverless instance the instant the handler returns — without
// the flush, the event may never leave the function.
export async function captureError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  if (!DSN) return
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined)
    await Sentry.flush(2000)
  } catch {
    /* never let monitoring break the request */
  }
}
