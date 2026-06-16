// components/Icon.tsx
// Curated inline line icons (Tabler geometry). Stroke is currentColor, so each
// icon takes the status tone set on its parent — shape says which domain, color
// says how alarming. No icon font / dependency. 24x24 viewBox.
import type { CSSProperties } from 'react'

// Multiple sub-paths per glyph are joined with '|'.
const PATHS: Record<string, string> = {
  // domain / metric
  flame: 'M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z',
  'chart-line': 'M4 4v16h16|M7.5 14.5l3 -3l2.5 2.5l4.5 -5.5',
  home: 'M5 12l-2 0l9 -9l9 9l-2 0|M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7|M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6',
  briefcase: 'M3 7m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z|M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2|M12 12l0 .01|M3 13a20 20 0 0 0 18 0',
  activity: 'M3 12h4l3 8l4 -16l3 8h4',
  bank: 'M3 21l18 0|M3 10l18 0|M5 6l7 -3l7 3|M4 10l0 11|M20 10l0 11|M8 14l0 3|M12 14l0 3|M16 14l0 3',
  globe: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0|M3.6 9h16.8|M3.6 15h16.8|M11.5 3a17 17 0 0 0 0 18|M12.5 3a17 17 0 0 1 0 18',
  droplet: 'M6.8 11a6 6 0 1 0 10.4 0l-5.2 -7z',
  // status
  'circle-check': 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18|M9 12l2 2l4 -4',
  circle: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18',
  minus: 'M5 12h14',
  'alert-triangle': 'M12 9v4|M10.24 3.957l-8.422 14.06a1.989 1.989 0 0 0 1.7 2.983h16.845a1.989 1.989 0 0 0 1.7 -2.983l-8.423 -14.06a1.989 1.989 0 0 0 -3.4 0z|M12 17h.01',
  'alert-circle': 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18|M12 8v4|M12 16h.01',
  'alert-octagon': 'M8.7 3h6.6l4.7 4.7v6.6l-4.7 4.7h-6.6l-4.7 -4.7v-6.6z|M12 8v4|M12 16h.01',
  'trending-down': 'M3 7l6 6l4 -4l8 8|M21 10l0 7l-7 0',
  'trending-up': 'M3 17l6 -6l4 4l8 -8|M14 7l7 0l0 7',
}

export type IconName = keyof typeof PATHS
type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'

// tone → status glyph (used wherever the old 🟢🟡🟠🔴🚨 tone dots appeared)
export const STATUS_ICON: Record<Tone, IconName> = {
  good: 'circle-check', neutral: 'minus', warn: 'alert-triangle', bad: 'alert-circle', crisis: 'alert-octagon',
}

// tab/domain → glyph (hero badges, Overview "watching" rows)
export const TAB_ICON: Record<string, IconName> = {
  inflation: 'flame', bonds: 'chart-line', housing: 'home', labor: 'briefcase',
  markets: 'activity', credit: 'bank', global: 'globe',
}

// break-meter event key → glyph (Overview recent breaks / recently cleared)
export const KEY_ICON: Record<string, IconName> = {
  cpi: 'flame', core: 'flame', wti: 'droplet', oil: 'droplet',
  treasury10y: 'chart-line', tenY: 'chart-line', thirtY: 'chart-line', yieldCurve: 'chart-line', fedfunds: 'chart-line',
  mortgage30: 'home', vix: 'activity', sp500: 'activity',
  hySpread: 'bank', igSpread: 'bank', joblessClaims: 'briefcase',
  dxy: 'globe', copper: 'globe', gold: 'globe',
}

export default function Icon({ name, size = 16, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }} aria-hidden="true">
      {d.split('|').map((p, i) => <path key={i} d={p} />)}
    </svg>
  )
}
