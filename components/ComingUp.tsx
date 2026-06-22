// components/ComingUp.tsx
// Calm "Coming up" banner — surfaces the soonest high-impact release within 72h
// (named "Coming up", not "Watchlist", to avoid colliding with the dashboard's
// interest Watchlist). Renders null when nothing is imminent. Two themes: the
// public graphite site and the light signed-in app.
import Icon from './Icon'
import type { EconomicEvent } from '../lib/economicCalendar'

type Theme = 'graphite' | 'app'
const PALETTE: Record<Theme, { bg: string; text: string; sub: string; accent: string; chipBg: string; border: string }> = {
  graphite: { bg: 'var(--card-bg)', text: 'var(--text-primary)', sub: 'var(--text-secondary)', accent: 'var(--warn)', chipBg: 'var(--warn-bg)', border: 'var(--border)' },
  app:      { bg: 'var(--c-surface)', text: 'var(--c-text)', sub: 'var(--c-text-soft)', accent: 'var(--c-warn)', chipBg: 'var(--c-warn-bg)', border: 'var(--c-border)' },
}

function whenLabel(daysUntil: number): string {
  if (daysUntil <= 0) return 'Releases today'
  if (daysUntil === 1) return 'Releases tomorrow'
  return `Releases in ${daysUntil} days`
}

export default function ComingUp({ events, theme }: { events: EconomicEvent[]; theme: Theme }) {
  const soon = events
    .filter(e => !e.released && e.daysUntil >= 0 && e.daysUntil <= 3)
    .sort((a, b) => a.daysUntil - b.daysUntil)[0]
  if (!soon) return null
  const p = PALETTE[theme]

  return (
    <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderLeft: `3px solid ${p.accent}`, borderRadius: 12, padding: '14px 16px', margin: '0 0 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ color: p.accent, display: 'inline-flex' }}><Icon name="calendar" size={16} /></span>
        <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: p.sub, fontWeight: 600 }}>Coming up</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: p.text }}>{soon.name}</span>
        <span style={{ fontSize: 13, color: p.accent }}>{whenLabel(soon.daysUntil)}</span>
      </div>
      {soon.impactBullets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {soon.impactBullets.map(b => (
            <span key={b} style={{ fontSize: 11.5, color: p.sub, background: p.chipBg, borderRadius: 7, padding: '3px 9px' }}>{b}</span>
          ))}
        </div>
      )}
    </div>
  )
}
