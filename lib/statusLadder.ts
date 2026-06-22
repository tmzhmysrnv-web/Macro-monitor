// lib/statusLadder.ts
// Single source for the macro status ladder used by the dashboard, the /digest
// preview, the Overview headline, and the weekly digest email. One set of
// boundaries (40 / 65 / 85) so the score, shield, headline, and bottom line can
// never disagree. Below 40 reads as stable; 40+ is elevated (the break meter is
// already amber there). Tone stays calm — amber caution until 65+, red beyond.

export type Tone = 'calm' | 'elevated' | 'high' | 'severe'

export function toneFor(total: number): Tone {
  if (total < 40) return 'calm'
  if (total < 65) return 'elevated'
  if (total < 85) return 'high'
  return 'severe'
}

export function headlineFor(total: number): string {
  if (total < 25) return 'Calm and steady'
  if (total < 40) return 'Stable but worth watching'   // matches the gauge's "worth watching" band
  if (total < 65) return 'Elevated — worth watching'
  if (total < 85) return 'High — stress is building'
  return 'Breaking — systemic stress'
}

// Bottom-line copy split around the one word that flips the sentence's meaning.
export function bottomLine(total: number): { h: string; lead: string; swap: string; tail: string } {
  if (total < 40) return { h: 'You can breathe easy.', lead: 'The economy remains in ', swap: 'stable', tail: ' territory. Enjoy your week. We\'ll keep watching.' }
  if (total < 65) return { h: 'Worth keeping an eye on.', lead: 'The economy is in ', swap: 'elevated', tail: ' territory — a few areas are building, but nothing is breaking.' }
  if (total < 85) return { h: 'Worth your attention.', lead: 'The economy is drifting into ', swap: 'shaky', tail: ' territory. We\'ll alert you if it crosses a line.' }
  return { h: 'We\'re watching this closely.', lead: 'The economy is in ', swap: 'fragile', tail: ' territory. You\'ll hear from us the moment your topics are affected.' }
}

// Directional week-over-week change line. Our weekChange is POSITIVE when stress
// rose (= things got worse), so positive → "Increased"/↑, negative → "Improved"/↓.
export type ChangeLine = { arrow: '↑' | '↓' | '→'; text: string; dir: 'worse' | 'better' | 'flat' }
export function changeLine(weekChange: number | null): ChangeLine {
  if (weekChange == null) return { arrow: '→', text: 'No prior week to compare', dir: 'flat' }
  const x = Math.round(weekChange)
  const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`
  if (x > 0) return { arrow: '↑', text: `Increased by ${pts(x)} this week`, dir: 'worse' }
  if (x < 0) return { arrow: '↓', text: `Improved by ${pts(Math.abs(x))} this week`, dir: 'better' }
  return { arrow: '→', text: 'Unchanged from last week', dir: 'flat' }
}

// Tone → CSS-var colors for the light app (dashboard / digest preview).
export const TONE_TEXT: Record<Tone, string> = { calm: 'var(--c-green-deep)', elevated: 'var(--c-warn)', high: 'var(--c-bad)', severe: 'var(--c-bad)' }
export const TONE_BADGE: Record<Tone, string> = { calm: 'var(--c-green)', elevated: 'var(--c-warn)', high: 'var(--c-bad)', severe: 'var(--c-bad)' }

// Tone → literal hex for email (no CSS vars in mail clients). Mirrors the light
// theme: green-deep / amber / red text, solid green / amber / red badges.
export const TONE_EMAIL: Record<Tone, { text: string; badge: string }> = {
  calm:     { text: '#25734C', badge: '#2F9160' },
  elevated: { text: '#854F0B', badge: '#C07A1C' },
  high:     { text: '#A3332E', badge: '#CC4B43' },
  severe:   { text: '#A3332E', badge: '#CC4B43' },
}
