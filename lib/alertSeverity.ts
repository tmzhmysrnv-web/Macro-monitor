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
