// lib/alertSeverity.ts
// Shared, dependency-free severity mapping for fired alerts. Lives on its own
// (not in alertEngine) so the client bundle can import it without pulling in the
// FRED/Yahoo model builders.

export type Severity = 1 | 2 | 3

// Tier metadata — reused by the in-app NotificationPanel and the email digest.
export const TIERS: Record<Severity, { label: string; color: string; bg: string }> = {
  3: { label: 'Critical', color: '#A32D2D', bg: '#FCEBEB' },
  2: { label: 'Alert',    color: '#854F0B', bg: '#FAEEDA' },
  1: { label: 'Update',   color: '#3B6D11', bg: '#EAF3DE' },
}

// Crisis-grade alert ids (the top rung of a ladder, or inherently severe).
const CRISIS = new Set([
  'cpi-severe', 'wti-shock', 'sp-bear', 'vix-40', 'hy-7', 'mortgage-8',
  'em-contagion', 'oil-shock', 'sahm', 'deep-inversion', 'cc-stress',
  'cre-distress', 'delinq-spike',
])

// Positive / "good news" events — surfaced but never alarming.
const POSITIVE = new Set(['uninversion'])

// Most alert ladders escalate by swapping ids (cpi-4 → cpi-5 → cpi-severe), so
// the id alone ranks them. Two alerts reuse a single id across tiers and must be
// ranked by their title instead (market-selloff, yield-spike).
export function severityOf(id: string, title: string): Severity {
  if (id === 'market-selloff') return /panic/i.test(title) ? 3 : 2
  if (id === 'yield-spike') return /disorderly/i.test(title) ? 3 : 2
  if (POSITIVE.has(id)) return 1
  if (CRISIS.has(id)) return 3
  return 2
}

// ── Alert ladders ──────────────────────────────────────────────────────
// Mutually-exclusive tiers of the SAME underlying metric grouped into a family
// with an ordinal rank. The cron emails only when a family's rank goes UP (or
// the family first appears) — a step DOWN (e.g. CPI 5% → 4%) is an improvement
// and stays silent. Ids not listed here are their own singleton family, ranked
// by severity (same-id title ladders like market-selloff/yield-spike included).
const LADDER: Record<string, { family: string; rank: number }> = {
  'cpi-4': { family: 'cpi', rank: 1 }, 'cpi-5': { family: 'cpi', rank: 2 }, 'cpi-severe': { family: 'cpi', rank: 3 },
  'wti-100': { family: 'wti', rank: 1 }, 'wti-shock': { family: 'wti', rank: 2 },
  'sp-correction': { family: 'sp-dd', rank: 1 }, 'sp-bear': { family: 'sp-dd', rank: 2 },
  'vix-30': { family: 'vix', rank: 1 }, 'vix-40': { family: 'vix', rank: 2 },
  'oil-100': { family: 'oil', rank: 1 }, 'oil-shock': { family: 'oil', rank: 2 },
  'dxy-warn': { family: 'dxy', rank: 1 }, 'dxy-stress': { family: 'dxy', rank: 2 },
  'em-stress': { family: 'em', rank: 1 }, 'em-contagion': { family: 'em', rank: 2 },
  'hy-5': { family: 'hy', rank: 1 }, 'hy-7': { family: 'hy', rank: 2 },
  'mortgage-7': { family: 'mortgage', rank: 1 }, 'mortgage-8': { family: 'mortgage', rank: 2 },
  'thirtY-high': { family: 'thirtY', rank: 1 }, 'thirtY-6': { family: 'thirtY', rank: 2 },
}

export function alertFamily(id: string): string {
  return LADDER[id]?.family ?? id
}

export function alertRank(id: string, severity: number): number {
  return LADDER[id]?.rank ?? severity
}

// The id of the next-higher tier in the same family (for "distance to next
// tier"), or null if this is the top rung or a singleton.
export function nextTierId(id: string): string | null {
  const cur = LADDER[id]
  if (!cur) return null
  for (const [k, v] of Object.entries(LADDER)) {
    if (v.family === cur.family && v.rank === cur.rank + 1) return k
  }
  return null
}
