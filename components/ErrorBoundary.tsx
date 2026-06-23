// components/ErrorBoundary.tsx
// Catches React render errors anywhere below it and reports them to Sentry
// (no-op without a DSN), then shows a minimal reload fallback instead of a blank
// screen. Render errors don't always reach window.onerror, so this is what gives
// the client error monitoring real coverage.
import React from 'react'
import { captureClientError } from '../lib/sentryClient'

type Props = { children: React.ReactNode }
type State = { hasError: boolean }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    captureClientError(error)
    if (process.env.NODE_ENV !== 'production') console.error(error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', fontFamily: 'var(--sans, system-ui, sans-serif)' }}>
          <div style={{ fontSize: 15, color: 'var(--text-secondary, #888)' }}>Something went wrong on this screen.</div>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border, #333)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
