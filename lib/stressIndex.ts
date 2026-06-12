// lib/stressIndex.ts
// Break Meter — a 0–100 "is the system breaking?" gauge.
//
// Why a redesign: a crisis is CONCENTRATED, not broad-based at the same instant,
// so averaging subsystem stress (the old model) structurally never reads as a
// break — 2008 and COVID only reached ~60. This is a WORST-OF + contagion model:
// the meter tracks the single most-broken subsystem, escalated when several
// break together. Each subsystem is scored on ABSOLUTE danger thresholds
// (calm / warn / break), so a real break — HY spreads >10%, VIX >50, claims
// >550k, deep curve inversion, a home-price crash — pegs its subsystem near 100
// no matter how calm everything else is.

import type { MacroData } from './fetchData'

type Dir = 'high' | 'low'
type Signal = { key: string; dir: Dir; calm: number; warn: number; brk: number; note: string }
type Subsystem = { key: string; label: string; signals: Signal[] }

export const SUBSYSTEMS: Subsystem[] = [
  { key: 'credit', label: 'Credit', signals: [
    { key: 'hySpread', dir: 'high', calm: 3.5, warn: 6, brk: 10, note: 'High-yield spreads' },
    { key: 'igSpread', dir: 'high', calm: 1.5, warn: 2.5, brk: 4, note: 'Investment-grade spreads' },
  ] },
  { key: 'volatility', label: 'Volatility', signals: [
    { key: 'vix', dir: 'high', calm: 16, warn: 28, brk: 50, note: 'VIX' },
  ] },
  { key: 'labor', label: 'Labor', signals: [
    { key: 'joblessClaims', dir: 'high', calm: 250, warn: 375, brk: 550, note: 'Jobless claims (k)' },
  ] },
  { key: 'bonds', label: 'Bonds & Rates', signals: [
    { key: 'treasury10y', dir: 'high', calm: 4, warn: 5.5, brk: 7, note: '10-year yield' },
    { key: 'yieldCurve', dir: 'low', calm: 0, warn: -0.5, brk: -1.5, note: 'Curve inversion' },
  ] },
  { key: 'housing', label: 'Housing', signals: [
    { key: 'mortgage30', dir: 'high', calm: 5, warn: 7.5, brk: 9.5, note: 'Mortgage rate' },
    { key: 'homePriceYoY', dir: 'low', calm: 0, warn: -3, brk: -12, note: 'Home-price crash' },
  ] },
  { key: 'inflation', label: 'Inflation', signals: [
    { key: 'cpi', dir: 'high', calm: 3, warn: 5, brk: 9, note: 'High inflation' },
    { key: 'cpi', dir: 'low', calm: 1, warn: 0, brk: -2, note: 'Deflation' },
  ] },
]

// Indicator keys the meter reads — used by the historical backfill.
export const BREAK_KEYS: string[] = Array.from(new Set(SUBSYSTEMS.flatMap(s => s.signals.map(g => g.key))))

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

// Map a value to 0–100 stress against calm/warn/break anchors (higher = worse).
// calm→~15, warn→50, break→90, beyond break→100.
function stressHigh(v: number, calm: number, warn: number, brk: number): number {
  const a = warn - calm, b = brk - warn
  if (v <= calm) return clamp(15 - (calm - v) / a * 15, 0, 15)
  if (v <= warn) return 15 + (v - calm) / a * 35
  if (v <= brk)  return 50 + (v - warn) / b * 40
  return clamp(90 + (v - brk) / b * 10, 90, 100)
}
function signalStress(sig: Signal, v: number): number {
  // 'low' direction: more-negative is worse — mirror through zero
  return sig.dir === 'high'
    ? stressHigh(v, sig.calm, sig.warn, sig.brk)
    : stressHigh(-v, -sig.calm, -sig.warn, -sig.brk)
}

export type SubsystemStress = {
  key: string
  label: string
  stress: number          // 0–100
  status: 'calm' | 'watch' | 'elevated' | 'stressed' | 'breaking'
  driver: string          // worst signal's label
  driverKey: string       // worst signal's indicator key (for trend lookup)
}
function subStatus(s: number): SubsystemStress['status'] {
  if (s >= 85) return 'breaking'
  if (s >= 65) return 'stressed'
  if (s >= 45) return 'elevated'
  if (s >= 25) return 'watch'
  return 'calm'
}

export type StressResult = {
  total: number
  level: 'calm' | 'guarded' | 'elevated' | 'high' | 'severe'
  verdict: string
  categories: SubsystemStress[]   // each subsystem's 0–100 stress, worst first
}
function indexLevel(total: number): { level: StressResult['level']; verdict: string } {
  if (total < 25) return { level: 'calm', verdict: 'No — conditions are calm' }
  if (total < 45) return { level: 'guarded', verdict: 'No — but worth watching' }
  if (total < 65) return { level: 'elevated', verdict: 'Not yet — a subsystem is under stress' }
  if (total < 85) return { level: 'high', verdict: 'Close — a subsystem is breaking' }
  return { level: 'severe', verdict: 'Yes — systemic stress' }
}

// Core: score every subsystem (worst signal within), then worst-of + contagion.
function computeFrom(getVal: (key: string) => number | null): { total: number; subsystems: SubsystemStress[] } {
  const subsystems: SubsystemStress[] = SUBSYSTEMS.map(sub => {
    let stress = 0, driver = '', driverKey = ''
    for (const sig of sub.signals) {
      const v = getVal(sig.key)
      if (v == null) continue
      const s = signalStress(sig, v)
      if (s > stress) { stress = s; driver = sig.note; driverKey = sig.key }
    }
    const r = Math.round(stress)
    return { key: sub.key, label: sub.label, stress: r, status: subStatus(r), driver, driverKey }
  })

  const stresses = subsystems.map(s => s.stress)
  const peak = stresses.length ? Math.max(...stresses) : 0
  const breadth = stresses.filter(s => s >= 50).length         // subsystems simultaneously breaking
  const contagion = breadth >= 2 ? (breadth - 1) * 6 : 0       // peak-dominant + modest contagion bump
  const total = Math.round(Math.min(100, peak + contagion))
  return { total, subsystems }
}

function valueForKey(data: MacroData, key: string): number | null {
  const map: Record<string, number | null> = {
    vix: data.vix, treasury10y: data.treasury10y, yieldCurve: data.yieldCurve,
    cpi: data.cpi, joblessClaims: data.joblessClaims, hySpread: data.hySpread,
    igSpread: data.igSpread, mortgage30: data.mortgage30, homePriceYoY: data.homePriceYoY,
  }
  return map[key] ?? null
}

export function computeStressIndex(data: MacroData): StressResult {
  const { total, subsystems } = computeFrom(k => valueForKey(data, k))
  subsystems.sort((a, b) => b.stress - a.stress)
  const { level, verdict } = indexLevel(total)
  return { total, level, verdict, categories: subsystems }
}

// Reconstruct the meter from a plain map of historical values (the backfill).
export function computeStressFromValues(values: Record<string, number | null>): number {
  return computeFrom(k => values[k] ?? null).total
}

// Per-subsystem stresses from a plain values map — used to measure how each
// subsystem moved over a window (driver trend arrows).
export function computeSubsystemsFromValues(values: Record<string, number | null>): SubsystemStress[] {
  return computeFrom(k => values[k] ?? null).subsystems
}
