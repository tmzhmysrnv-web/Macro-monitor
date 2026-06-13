// lib/metricTone.ts
// Shared per-metric tone helpers so every intelligence tab colors its driver
// metric cards the same way the raw indicator cards do (green = healthy, amber
// = watch, red = stress). Used by housing / bonds / credit / inflation models.
//
// Two directions only — pick the one matching the metric's danger side:
//   toneHigh: a HIGH value is the dangerous one (spreads, inflation, rates…)
//   toneLow:  a LOW value is the dangerous one  (loan growth, curve spread…)
// Levels with no clear good/bad direction (prices, listings) get no tone.

export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'

// High is bad: ≥crisis → crisis, ≥bad → bad, ≥warn → warn, else good.
export function toneHigh(v: number | null, warn: number, bad: number, crisis = Infinity): Tone | undefined {
  if (v == null) return undefined
  if (v >= crisis) return 'crisis'
  if (v >= bad) return 'bad'
  if (v >= warn) return 'warn'
  return 'good'
}

// Low is bad: ≤crisis → crisis, ≤bad → bad, ≤warn → warn, else good.
export function toneLow(v: number | null, warn: number, bad: number, crisis = -Infinity): Tone | undefined {
  if (v == null) return undefined
  if (v <= crisis) return 'crisis'
  if (v <= bad) return 'bad'
  if (v <= warn) return 'warn'
  return 'good'
}
