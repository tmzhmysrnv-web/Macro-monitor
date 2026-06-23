// lib/sentryClient.ts
// Lightweight BROWSER-side error reporting (audit: error monitoring).
// @sentry/browser auto-captures window.onerror + unhandledrejection once init()
// runs; the ErrorBoundary additionally feeds it React render errors. No-op until
// NEXT_PUBLIC_SENTRY_DSN is set (Next inlines that at build time). Errors only —
// no tracing/replay — to stay inside Sentry's free tier.
import * as Sentry from '@sentry/browser'

let inited = false

export function initSentryClient(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (inited || !dsn || typeof window === 'undefined') return
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    environment: process.env.NODE_ENV,
  })
  inited = true
}

export function captureClientError(err: unknown): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  try { Sentry.captureException(err) } catch { /* ignore */ }
}
