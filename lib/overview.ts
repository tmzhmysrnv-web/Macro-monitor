// lib/overview.ts
// Derives the Overview page's "early-warning" intelligence from the raw data:
//   • Active Alerts      — what is currently breaking
//   • Watching Closely   — indicators nearest their alert threshold (what's next)
//   • Recent Breaks      — notable thresholds crossed in the last few months
//   • Today's Briefing   — one-line concern + stabilizer for the situation card
// The Break Meter (lib/stressIndex) gives the score; this gives the answer.

import type { MacroData } from './fetchData'
import { INDICATORS, getStatus, getContextText, type Indicator } from './thresholds'
import { computeStressFromValues, computeSubsystemsFromValues, BREAK_KEYS, type StressResult } from './stressIndex'
import type { HistoryMap } from './fetchHistory'

// ── shared helpers ────────────────────────────────────────────────────
function valueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, fedfunds: data.fedfunds,
    cpi: data.cpi, joblessClaims: data.joblessClaims, yieldCurve: data.yieldCurve,
    hySpread: data.hySpread, igSpread: data.igSpread, sp500: data.sp500,
    dxy: data.dxy, gold: data.gold, oil: data.oil, copper: data.copper,
    mortgage30: data.mortgage30,
  }
  return map[key] ?? null
}

// Friendly, headline-style labels for events (warmer than the terse card labels)
const EVENT_LABEL: Record<string, string> = {
  mortgage30: 'Mortgage rates', treasury10y: '10Y Treasury yield', cpi: 'Inflation (CPI)',
  vix: 'VIX', oil: 'Oil', hySpread: 'High-yield spreads', igSpread: 'IG credit spreads',
  joblessClaims: 'Jobless claims', yieldCurve: 'Yield curve',
}

// Which domain tab each indicator belongs to — used to tie "Watching Closely"
// items back to a category (Housing/Credit/Inflation…) and route clicks to the
// matching intelligence/section tab.
export const METRIC_CATEGORY: Record<string, { tab: string; label: string }> = {
  treasury10y: { tab: 'bonds', label: 'Bonds' },
  yieldCurve:  { tab: 'bonds', label: 'Bonds' },
  fedfunds:    { tab: 'bonds', label: 'Bonds' },
  mortgage30:  { tab: 'housing', label: 'Housing' },
  hySpread:    { tab: 'credit', label: 'Credit' },
  igSpread:    { tab: 'credit', label: 'Credit' },
  cpi:         { tab: 'inflation', label: 'Inflation' },
  oil:         { tab: 'inflation', label: 'Inflation' },
  joblessClaims: { tab: 'labor', label: 'Labor' },
  vix:         { tab: 'markets', label: 'Markets' },
  sp500:       { tab: 'markets', label: 'Markets' },
  dxy:         { tab: 'global', label: 'Global' },
  gold:        { tab: 'global', label: 'Global' },
  copper:      { tab: 'global', label: 'Global' },
}

// Short "why this matters" — mirrors the What-Changed panel, used under Recent
// Breaks rows so each crossed threshold carries its own one-liner.
const METRIC_WHY: Record<string, string> = {
  treasury10y: 'Drives borrowing costs', mortgage30: 'Sets housing affordability',
  vix: 'Market volatility', joblessClaims: 'Labor market health', oil: 'Energy & inflation input',
  cpi: 'Cost of living', hySpread: 'Corporate credit stress', igSpread: 'Early credit warning',
  yieldCurve: 'Recession signal', fedfunds: 'Fed policy stance', dxy: 'Dollar strength',
  sp500: 'Broad equity market', gold: 'Safe-haven demand', copper: 'Global growth pulse',
}

// Directional, plain-English blurb for "Watching Closely" — what a further move
// in this indicator would actually do ("10Y Treasury could affect borrowing
// costs"). Longer/forward-looking, distinct from the terse METRIC_WHY above.
const WATCH_WHY: Record<string, string> = {
  treasury10y:  'Could lift borrowing costs across the economy',
  mortgage30:   'Could squeeze housing affordability',
  vix:          'Signals rising market fear',
  cpi:          'Keeps the cost of living elevated',
  oil:          'Feeds through to inflation and pump prices',
  hySpread:     'Flags growing corporate credit stress',
  igSpread:     'An early warning on credit conditions',
  joblessClaims:'Points to a softening labor market',
  yieldCurve:   'A classic recession warning',
  fedfunds:     'Shapes the Fed’s policy stance',
  dxy:          'A strong dollar tightens global conditions',
  gold:         'Rising demand signals safe-haven flight',
  copper:       'A read on global growth momentum',
  sp500:        'Tracks the broad equity market’s direction',
}

// Each Break-Meter subsystem maps to the tab that explains it in depth — so a
// "biggest concern: Credit" routes to the Credit intelligence model, etc.
const SUBSYS_TAB: Record<string, string> = {
  credit: 'credit', volatility: 'markets', labor: 'labor',
  bonds: 'bonds', housing: 'housing', inflation: 'inflation',
}

// Format a level/value with the right unit affix
function fmtLevel(key: string, v: number): string {
  if (key === 'oil') return `$${v}`
  if (key === 'joblessClaims') return `${v}k`
  if (key === 'vix' || key === 'dxy') return `${v}`
  if (['mortgage30', 'treasury10y', 'cpi', 'hySpread', 'igSpread', 'yieldCurve'].includes(key)) {
    return `${v % 1 === 0 ? v : v.toFixed(2)}%`
  }
  return `${v}`
}

// Indicators where a RISING value is the dangerous direction
const DANGER_UP = new Set(['mortgage30', 'treasury10y', 'cpi', 'vix', 'oil', 'hySpread', 'igSpread', 'joblessClaims', 'dxy'])

// ── 1. Active Alerts ──────────────────────────────────────────────────
export type Alert = { key: string; label: string; message: string }

export function buildAlerts(data: MacroData): Alert[] {
  const alerts: Alert[] = []
  for (const ind of INDICATORS) {
    const v = valueForKey(data, ind.key)
    if (v == null) continue
    if (getStatus(ind, v) !== 'alert') continue
    const message = getContextText(ind.key, v, 'alert') || ind.description
    alerts.push({ key: ind.key, label: ind.label, message })
  }
  return alerts
}

// ── 2. Watching Closely ───────────────────────────────────────────────
// Indicators that aren't alerting yet but sit closest to their threshold.
export type WatchItem = {
  key: string; label: string; text: string; heat: 'hot' | 'near'; pctToGo: number
  why: string                                       // directional plain-English blurb
  category: { tab: string; label: string } | null  // domain it belongs to / routes to
}

function gapText(ind: Indicator, gap: number): string {
  const g = gap >= 10 ? Math.round(gap).toString() : gap.toFixed(2).replace(/\.?0+$/, '')
  const unit = ind.unit
  const body = ind.unitPosition === 'prefix' ? `${unit}${g}` : `${g}${unit}`
  return `${body} from alert`
}

export function buildWatching(data: MacroData): WatchItem[] {
  const items: WatchItem[] = []
  for (const ind of INDICATORS) {
    const v = valueForKey(data, ind.key)
    if (v == null) continue
    const status = getStatus(ind, v)
    if (status === 'alert') continue // already broken — lives in Alerts

    // Two-sided indicators (e.g. DXY) sit between an upper and lower threshold.
    // At mid-band they aren't "about to break" in either direction, so only
    // surface them once they're actually in the warn zone.
    if (ind.alertAbove !== undefined && ind.alertBelow !== undefined && status === 'ok') continue

    let gap: number | null = null, norm: number | null = null
    if (ind.alertAbove !== undefined && v < ind.alertAbove) {
      gap = ind.alertAbove - v
      norm = gap / Math.abs(ind.alertAbove)
    }
    if (ind.alertBelow !== undefined && v > ind.alertBelow) {
      const g2 = v - ind.alertBelow
      const n2 = g2 / Math.abs(ind.alertBelow)
      if (norm == null || n2 < norm) { gap = g2; norm = n2 }
    }
    if (gap == null || norm == null) continue
    if (norm > 0.35) continue // not close enough to be "watching"

    items.push({
      key: ind.key,
      label: ind.label,
      text: gapText(ind, gap),
      heat: status === 'warn' ? 'hot' : 'near',
      pctToGo: norm,
      why: WATCH_WHY[ind.key] ?? '',
      category: METRIC_CATEGORY[ind.key] ?? null,
    })
  }
  return items.sort((a, b) => a.pctToGo - b.pctToGo).slice(0, 5)
}

// ── 3. Recent Breaks ──────────────────────────────────────────────────
// Notable round-number thresholds crossed within the last ~5 months.
export type BreakEvent = { key: string; text: string; why: string; tone: 'bad' | 'good'; date: string; daysAgo: number }

// Round levels worth flagging when crossed, per indicator
const MILESTONES: Record<string, number[]> = {
  mortgage30: [6, 7, 8],
  treasury10y: [4, 4.5, 5],
  cpi: [3, 4, 5, 6],
  vix: [20, 30, 40],
  oil: [80, 100, 120],
  hySpread: [5, 6, 8],
  igSpread: [1.5, 2],
  joblessClaims: [300, 350, 400],
}

const WINDOW_DAYS = 150

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function buildRecentBreaks(history: HistoryMap): BreakEvent[] {
  const now = new Date()
  const events: BreakEvent[] = []

  // Generic milestone crossings for danger-up indicators
  for (const key of Object.keys(MILESTONES)) {
    const series = history[key]
    if (!series || series.length < 2) continue
    const danger = DANGER_UP.has(key)
    let best: BreakEvent | null = null
    for (const level of MILESTONES[key]) {
      // walk forward, find the LATEST sign-flip around `level`
      for (let i = 1; i < series.length; i++) {
        const prev = series[i - 1].value, cur = series[i].value
        const crossedUp = prev < level && cur >= level
        const crossedDown = prev >= level && cur < level
        if (!crossedUp && !crossedDown) continue
        const d = new Date(series[i].date)
        const ago = daysBetween(d, now)
        if (ago < 0 || ago > WINDOW_DAYS) continue
        const rose = crossedUp
        const tone: 'bad' | 'good' = danger ? (rose ? 'bad' : 'good') : (rose ? 'good' : 'bad')
        const verb = rose ? 'crossed' : 'fell below'
        const text = `${EVENT_LABEL[key]} ${verb} ${fmtLevel(key, level)}`
        const ev: BreakEvent = { key, text, why: METRIC_WHY[key] ?? '', tone, date: series[i].date, daysAgo: ago }
        if (!best || ago < best.daysAgo) best = ev
      }
    }
    if (best) events.push(best)
  }

  // Yield-curve inversion is the signal that matters, not a round number
  const yc = history['yieldCurve']
  if (yc && yc.length >= 2) {
    let best: BreakEvent | null = null
    for (let i = 1; i < yc.length; i++) {
      const prev = yc[i - 1].value, cur = yc[i].value
      const invertedNow = prev >= 0 && cur < 0
      const normalizedNow = prev < 0 && cur >= 0
      if (!invertedNow && !normalizedNow) continue
      const ago = daysBetween(new Date(yc[i].date), now)
      if (ago < 0 || ago > WINDOW_DAYS) continue
      const ev: BreakEvent = {
        key: 'yieldCurve',
        text: invertedNow ? 'Yield curve inverted' : 'Yield curve un-inverted',
        why: METRIC_WHY['yieldCurve'],
        tone: invertedNow ? 'bad' : 'good',
        date: yc[i].date,
        daysAgo: ago,
      }
      if (!best || ago < best.daysAgo) best = ev
    }
    if (best) events.push(best)
  }

  return events.sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 6)
}

// ── 4. Today's Briefing ───────────────────────────────────────────────
export type Briefing = {
  headline: string
  concern: { label: string; detail: string; tab: string } | null
  stabilizer: { label: string; detail: string; tab: string } | null
}

function headlineFor(total: number): string {
  if (total <= 20) return 'Calm and steady'
  if (total <= 40) return 'Stable but worth watching'
  if (total <= 60) return 'Elevated — stress is building'
  if (total <= 80) return 'High risk — a subsystem is close to breaking'
  return 'Breaking — systemic stress'
}

// Direction of each indicator over the last ~`days`, with a deadband so small
// wiggles read as "flat" rather than flipping Rising/Cooling. A single noisy
// week (or a stale monthly print) shouldn't claim inflation is "cooling".
export function buildTrendDirections(
  data: MacroData,
  history: HistoryMap,
  days = 90,
  deadband = 0.05,
): Record<string, 'up' | 'down' | 'flat'> {
  const now = Date.now()
  const out: Record<string, 'up' | 'down' | 'flat'> = {}
  for (const ind of INDICATORS) {
    const cur = valueForKey(data, ind.key)
    const series = history[ind.key]
    if (cur == null || !series || series.length < 2) continue
    let past: number | null = null
    for (let i = series.length - 1; i >= 0; i--) {
      const ago = (now - new Date(series[i].date).getTime()) / 86400000
      if (ago >= days) { past = series[i].value; break }
    }
    if (past == null) past = series[0].value
    const move = (cur - past) / (Math.abs(past) || 1)
    out[ind.key] = Math.abs(move) < deadband ? 'flat' : move > 0 ? 'up' : 'down'
  }
  return out
}

// Forward-filled Break Meter input values as of a point in time (so
// monthly/weekly series stay aligned). Returns null if too sparse to score.
function valuesAsOf(history: HistoryMap, asOf: number): Record<string, number | null> | null {
  const vals: Record<string, number | null> = {}
  let have = 0
  for (const key of BREAK_KEYS) {
    const series = history[key]
    let v: number | null = null
    if (series) {
      for (let i = series.length - 1; i >= 0; i--) {
        if (new Date(series[i].date).getTime() <= asOf) { v = series[i].value; break }
      }
    }
    vals[key] = v
    if (v != null) have++
  }
  return have < Math.ceil(BREAK_KEYS.length * 0.6) ? null : vals
}

// How much the Break Meter has moved over the last `days` — same for everyone,
// reconstructed from the daily history. Positive = things got worse.
export function buildMeterChange(history: HistoryMap, days = 7): number | null {
  const now = Date.now()
  const cur = valuesAsOf(history, now)
  const prev = valuesAsOf(history, now - days * 86400000)
  if (!cur || !prev) return null
  return computeStressFromValues(cur) - computeStressFromValues(prev)
}

// Per-subsystem movement over the last `days`. Only subsystems that actually
// moved (>= `minDelta` stress points) get an arrow — so when the meter is flat
// week-over-week, no arrows appear. Keyed by subsystem key.
export function buildDriverTrends(history: HistoryMap, days = 7, minDelta = 2): Record<string, 'up' | 'down' | 'flat'> {
  const now = Date.now()
  const cur = valuesAsOf(history, now)
  const prev = valuesAsOf(history, now - days * 86400000)
  const out: Record<string, 'up' | 'down' | 'flat'> = {}
  if (!cur || !prev) return out
  const subsNow = computeSubsystemsFromValues(cur)
  const subsPrev = new Map(computeSubsystemsFromValues(prev).map(s => [s.key, s.stress]))
  for (const s of subsNow) {
    const before = subsPrev.get(s.key)
    if (before == null) { out[s.key] = 'flat'; continue }
    const delta = s.stress - before
    out[s.key] = delta >= minDelta ? 'up' : delta <= -minDelta ? 'down' : 'flat'
  }
  return out
}

export function buildBriefing(stress: StressResult, alertKeys: Set<string> = new Set()): Briefing {
  const cats = stress.categories // already sorted worst-first
  const top = cats[0]
  // A subsystem with an active alert is never a "stabilizer", even if its
  // break-distance score is low (e.g. inflation alerts at 4% but only "breaks"
  // near 9%). Pick the calmest subsystem that isn't currently alerting.
  const calmest = [...cats].reverse().find(c => !alertKeys.has(c.driverKey))
  return {
    headline: headlineFor(stress.total),
    concern: top && top.stress >= 25 ? { label: top.label, detail: top.driver, tab: SUBSYS_TAB[top.key] ?? 'overview' } : null,
    stabilizer: calmest && calmest.stress < 25 ? { label: calmest.label, detail: calmest.driver, tab: SUBSYS_TAB[calmest.key] ?? 'overview' } : null,
  }
}
