// lib/labor.ts
// Labor-market intelligence model. Answers one question: "is the job market
// strengthening or weakening?". Four themes — Employment Health, Hiring
// Activity, Layoff Pressure, Wage Growth — each scored on real FRED data; the
// overall Labor Status is the dominant trend, with Layoff Pressure weighted
// heaviest (it's the clearest early sign conditions are deteriorating).
//
// Metric notes (no free real-time public source):
//   Challenger layoff announcements -> not free; proxied by JOLTS layoffs &
//                                      discharges rate (JTSLDR).

import { fredFetch } from './fred'
import { toneHigh, toneLow, type Tone as MetricTone } from './metricTone'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

export type Obs = { date: string; value: number }

async function fredSeries(seriesId: string, limit: number, units = 'lin'): Promise<Obs[]> {
  try {
    const url = `${FRED_BASE}?series_id=${seriesId}&units=${units}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${limit}`
    const res = await fredFetch(url, { next: { revalidate: 3600 } })
    if (!res || !res.ok) return []
    const data = await res.json()
    return (data.observations || [])
      .filter((o: { value: string }) => o.value !== '.' && o.value !== '')
      .map((o: { date: string; value: string }) => ({ date: o.date, value: parseFloat(o.value) }))
  } catch { return [] }
}

function pctChange(latest: number | null, past: number | null): number | null {
  if (latest == null || past == null || past === 0) return null
  return parseFloat(((latest - past) / Math.abs(past) * 100).toFixed(1))
}
// Year-over-year % from a monthly level series (desc).
function yoyFromLevel(obs: Obs[]): number | null {
  if (obs.length < 13 || obs[12].value === 0) return null
  return parseFloat(((obs[0].value / obs[12].value - 1) * 100).toFixed(1))
}
// Month-over-month change series (desc) from a level series — e.g. payrolls.
function changeSeries(obs: Obs[]): Obs[] {
  const out: Obs[] = []
  for (let i = 0; i + 1 < obs.length; i++) out.push({ date: obs[i].date, value: parseFloat((obs[i].value - obs[i + 1].value).toFixed(1)) })
  return out
}
// Sahm-rule gap: 3-month avg unemployment minus its trailing-12-month low.
function sahmGap(unrate: Obs[]): number | null {
  if (unrate.length < 15) return null
  const ma: number[] = []
  for (let i = 0; i + 2 < unrate.length && i < 14; i++) ma.push((unrate[i].value + unrate[i + 1].value + unrate[i + 2].value) / 3)
  if (ma.length < 12) return null
  const cur = ma[0], low = Math.min(...ma.slice(0, 12))
  return parseFloat((cur - low).toFixed(2))
}

// ── shared card helpers (mirror the other intelligence tabs) ──────────
export type MetricCard = {
  label: string; value: string; sub?: string; unit?: string
  tone?: MetricTone
  points?: { date: string; value: number }[]
  pctl?: number; histLabel?: string
  alertText?: string; alertProximity?: number
}
function spark(obs: Obs[], max = 48): { date: string; value: number }[] | undefined {
  if (!obs || obs.length < 2) return undefined
  const asc = [...obs].reverse()
  if (asc.length <= max) return asc.map(o => ({ date: o.date, value: o.value }))
  const step = Math.ceil(asc.length / max)
  return asc.filter((_, i) => i % step === 0 || i === asc.length - 1).map(o => ({ date: o.date, value: o.value }))
}
function hist(obs: Obs[]): { pctl?: number; histLabel?: string } {
  if (!obs || obs.length < 8) return {}
  const vals = obs.map(o => o.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  if (max === min) return {}
  const pctl = Math.round((obs[0].value - min) / (max - min) * 100)
  const histLabel = pctl <= 20 ? 'historically low' : pctl < 40 ? 'below normal'
    : pctl <= 60 ? 'historically normal' : pctl < 80 ? 'above normal' : 'historically high'
  return { pctl, histLabel }
}
// distance to an upper alert threshold (for "high is bad" metrics)
function alertAbove(value: number | null, threshold: number, unit = '%'): { alertText?: string; alertProximity?: number } {
  if (value == null || value >= threshold) return {}
  return { alertText: `${(threshold - value).toFixed(unit === 'k' ? 0 : 2)}${unit} from ${threshold}${unit} alert`, alertProximity: Math.max(0, Math.min(1, value / threshold)) }
}

const fPct = (v: number | null, d = 1) => v == null ? '—' : `${v.toFixed(d)}%`
const fK = (v: number | null) => v == null ? '—' : `${Math.round(v / 1000)}k`             // claims (raw count → k)
const fMil = (v: number | null) => v == null ? '—' : `${(v / 1000).toFixed(2)}M`            // JOLTS level (thousands → M)
const fClaimsMil = (v: number | null) => v == null ? '—' : `${(v / 1_000_000).toFixed(2)}M` // continuing claims (raw → M)
const fJobs = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v)}k`

export type LaborData = {
  unrate: Obs[]; payems: Obs[]; emratio: Obs[]
  jolts: Obs[]; hires: Obs[]; unemploy: Obs[]
  icsa: Obs[]; ccsa: Obs[]; layoffRate: Obs[]
  ahe: Obs[]; cpi: Obs[]
}

export async function fetchLaborData(): Promise<LaborData> {
  const [unrate, payems, emratio, jolts, hires, unemploy, icsa, ccsa, layoffRate, ahe, cpi] = await Promise.all([
    fredSeries('UNRATE', 180),   // unemployment rate, monthly %
    fredSeries('PAYEMS', 80),    // nonfarm payrolls, thousands (level)
    fredSeries('EMRATIO', 80),   // employment-to-population ratio %
    fredSeries('JTSJOL', 80),    // JOLTS job openings, thousands
    fredSeries('JTSHIR', 80),    // hires rate %
    fredSeries('UNEMPLOY', 80),  // unemployed level, thousands
    fredSeries('ICSA', 300),     // initial jobless claims, weekly (count)
    fredSeries('CCSA', 300),     // continuing claims, weekly (count)
    fredSeries('JTSLDR', 80),    // layoffs & discharges rate % (Challenger proxy)
    fredSeries('CES0500000003', 80), // avg hourly earnings, $ (total private)
    fredSeries('CPIAUCSL', 20),  // CPI index — for real wage
  ])
  return { unrate, payems, emratio, jolts, hires, unemploy, icsa, ccsa, layoffRate, ahe, cpi }
}

// ── Category scoring ──────────────────────────────────────────────────
export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
export type Category = {
  key: string; label: string; status: string; tone: Tone; fill: number
  signals: string[]; metrics: MetricCard[]
}
const TONE_FILL: Record<Tone, number> = { good: 0.9, neutral: 0.55, warn: 0.4, bad: 0.18, crisis: 0.08 }
function withFill(c: Omit<Category, 'fill'>): Category { return { ...c, fill: TONE_FILL[c.tone] } }

// 1 ── Employment Health (are jobs still being created?) ────────────────
function scoreEmployment(d: LaborData): Omit<Category, 'fill'> {
  const unemp = d.unrate[0]?.value ?? null
  const pc = d.payems.length >= 2 ? parseFloat((d.payems[0].value - d.payems[1].value).toFixed(0)) : null
  const emp = d.emratio[0]?.value ?? null
  const sahm = sahmGap(d.unrate)
  const low12 = d.unrate.length >= 12 ? Math.min(...d.unrate.slice(0, 12).map(o => o.value)) : null
  const rise = unemp != null && low12 != null ? parseFloat((unemp - low12).toFixed(1)) : null
  const signals: string[] = []
  if (unemp != null) signals.push(`Unemployment at ${fPct(unemp)}${rise != null && rise >= 0.3 ? ` — up ${rise.toFixed(1)}pp from its 12-month low` : ' — historically low'}`)
  if (pc != null) signals.push(`Payrolls ${pc >= 0 ? 'added' : 'lost'} ${Math.abs(Math.round(pc))}k jobs last month`)
  if (emp != null) signals.push(`${emp.toFixed(1)}% of working-age adults are employed (emp-pop ratio)`)

  let status: string, tone: Tone
  if ((unemp != null && unemp >= 5) || (sahm != null && sahm >= 0.5) || (pc != null && pc < 0)) { status = 'Weakening'; tone = 'bad' }
  else if ((pc != null && pc < 100) || (rise != null && rise >= 0.4)) { status = 'Slowing'; tone = 'warn' }
  else if (pc != null && pc >= 200 && unemp != null && unemp <= 4) { status = 'Strong Growth'; tone = 'good' }
  else if (unemp != null && unemp <= 4.5 && pc != null && pc >= 100) { status = 'Healthy'; tone = 'good' }
  else { status = 'Stable'; tone = 'neutral' }

  const metrics: MetricCard[] = [
    { label: 'Unemployment Rate', value: fPct(unemp), unit: '%', tone: toneHigh(unemp, 4.5, 5, 6), points: spark(d.unrate), ...hist(d.unrate), ...alertAbove(unemp, 5) },
    { label: 'Payroll Growth', value: fJobs(pc), sub: 'jobs last month', tone: toneLow(pc, 100, 0), points: spark(changeSeries(d.payems)) },
    { label: 'Employment-Pop Ratio', value: fPct(emp), unit: '%', points: spark(d.emratio), ...hist(d.emratio) },
  ]
  return { key: 'employment', label: 'Employment Health', status, tone, signals, metrics }
}

// 2 ── Hiring Activity (are companies still hiring?) ────────────────────
// Early indicator — hiring demand typically weakens before unemployment rises.
function scoreHiring(d: LaborData): Omit<Category, 'fill'> {
  const openings = d.jolts[0]?.value ?? null
  const unemployed = d.unemploy[0]?.value ?? null
  const vu = openings != null && unemployed != null && unemployed !== 0 ? parseFloat((openings / unemployed).toFixed(2)) : null
  const hires = d.hires[0]?.value ?? null
  const openingsYoY = yoyFromLevel(d.jolts)
  const signals: string[] = []
  if (openings != null) signals.push(`${fMil(openings)} job openings${openingsYoY != null ? ` (${openingsYoY >= 0 ? '+' : ''}${openingsYoY}% YoY)` : ''}`)
  if (vu != null) signals.push(`${vu.toFixed(2)} openings for every unemployed worker${vu >= 1.2 ? ' — employers still competing for workers' : vu < 1 ? ' — more job-seekers than openings' : ''}`)
  if (hires != null) signals.push(`Hiring rate at ${fPct(hires)} of employment`)

  let status: string, tone: Tone
  if (vu != null && vu < 0.8) { status = 'Weak Demand'; tone = 'bad' }
  else if ((vu != null && vu < 1.0) || (openingsYoY != null && openingsYoY <= -15)) { status = 'Cooling Demand'; tone = 'warn' }
  else if (vu != null && vu < 1.2) { status = 'Normal Demand'; tone = 'neutral' }
  else if (vu != null && vu < 1.5) { status = 'Healthy Hiring'; tone = 'good' }
  else { status = 'Strong Demand'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'Job Openings', value: fMil(openings), sub: openingsYoY != null ? `${openingsYoY >= 0 ? '+' : ''}${openingsYoY}% YoY` : 'JOLTS', tone: toneLow(vu, 1.0, 0.8), points: spark(d.jolts), ...hist(d.jolts) },
    { label: 'Hiring Rate', value: fPct(hires), unit: '%', tone: toneLow(hires, 3.5, 3.0), points: spark(d.hires), ...hist(d.hires) },
    { label: 'Openings per Unemployed', value: vu != null ? vu.toFixed(2) : '—', sub: '1.0 = balanced', tone: toneLow(vu, 1.0, 0.8) },
  ]
  return { key: 'hiring', label: 'Hiring Activity', status, tone, signals, metrics }
}

// 3 ── Layoff Pressure (are employers cutting workers?) ─────────────────
// Heavily weighted — layoffs are among the clearest signs of deterioration.
function scoreLayoff(d: LaborData): Omit<Category, 'fill'> {
  const ic = d.icsa[0]?.value ?? null          // raw count
  const cc = d.ccsa[0]?.value ?? null           // raw count
  const ldr = d.layoffRate[0]?.value ?? null
  const icK = ic != null ? ic / 1000 : null
  const ccYoY = pctChange(cc, d.ccsa.find(o => { const t = new Date(d.ccsa[0].date); t.setDate(t.getDate() - 365); return new Date(o.date) <= t })?.value ?? null)
  const signals: string[] = []
  if (icK != null) signals.push(`Initial jobless claims at ${Math.round(icK)}k/week — ${icK >= 300 ? 'elevated' : icK >= 260 ? 'creeping up' : 'low and stable'}`)
  if (cc != null) signals.push(`${fClaimsMil(cc)} continuing claims${ccYoY != null ? ` (${ccYoY >= 0 ? '+' : ''}${ccYoY}% YoY)` : ''} — how long the unemployed stay jobless`)
  if (ldr != null) signals.push(`Layoffs & discharges rate at ${fPct(ldr)} (JOLTS — Challenger figures aren't free)`)

  let status: string, tone: Tone
  if (icK != null && icK >= 400) { status = 'Labor Warning'; tone = 'crisis' }
  else if ((icK != null && icK >= 300) || (cc != null && cc >= 2_100_000)) { status = 'Layoff Pressure'; tone = 'bad' }
  else if ((icK != null && icK >= 260) || (cc != null && cc >= 1_950_000) || (ldr != null && ldr >= 1.5)) { status = 'Rising Layoffs'; tone = 'warn' }
  else if (icK != null && icK >= 235) { status = 'Watchlist'; tone = 'neutral' }
  else { status = 'Low Layoff Risk'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'Initial Claims', value: fK(ic), sub: 'per week', tone: toneHigh(icK, 260, 300, 400), points: spark(d.icsa), ...hist(d.icsa), ...alertAbove(icK, 300, 'k') },
    { label: 'Continuing Claims', value: fClaimsMil(cc), tone: toneHigh(cc, 1_950_000, 2_100_000), points: spark(d.ccsa), ...hist(d.ccsa) },
    { label: 'Layoff Rate', value: fPct(ldr), unit: '%', sub: 'JOLTS · Challenger proxy', tone: toneHigh(ldr, 1.4, 1.7), points: spark(d.layoffRate), ...hist(d.layoffRate) },
  ]
  return { key: 'layoff', label: 'Layoff Pressure', status, tone, signals, metrics }
}

// 4 ── Wage Growth (are workers gaining or losing ground?) ──────────────
function scoreWages(d: LaborData): Omit<Category, 'fill'> {
  const aheYoY = yoyFromLevel(d.ahe)
  const cpiYoY = yoyFromLevel(d.cpi)
  const real = aheYoY != null && cpiYoY != null ? parseFloat((aheYoY - cpiYoY).toFixed(1)) : null
  const signals: string[] = []
  if (aheYoY != null) signals.push(`Average hourly earnings up ${fPct(aheYoY)} YoY`)
  if (real != null) signals.push(real >= 0 ? `Wages are outpacing inflation by ${real.toFixed(1)}pp — workers gaining real ground` : `Inflation is outpacing wages by ${Math.abs(real).toFixed(1)}pp — workers losing real ground`)
  if (cpiYoY != null) signals.push(`Inflation running at ${fPct(cpiYoY)} for comparison`)

  let status: string, tone: Tone
  if ((real != null && real < -1) || (aheYoY != null && aheYoY < 2.5)) { status = 'Weak'; tone = 'bad' }
  else if ((real != null && real < 0) || (aheYoY != null && aheYoY < 3.2)) { status = 'Slowing'; tone = 'warn' }
  else if (real != null && real < 0.8) { status = 'Stable'; tone = 'neutral' }
  else if (aheYoY != null && aheYoY >= 4.5 && real != null && real >= 1.5) { status = 'Strong Wage Growth'; tone = 'good' }
  else { status = 'Healthy'; tone = 'good' }

  // Build a YoY sparkline for earnings from the level series.
  const aheYoYObs: Obs[] = []
  for (let i = 0; i + 12 < d.ahe.length; i++) aheYoYObs.push({ date: d.ahe[i].date, value: parseFloat(((d.ahe[i].value / d.ahe[i + 12].value - 1) * 100).toFixed(2)) })

  const metrics: MetricCard[] = [
    { label: 'Avg Hourly Earnings', value: fPct(aheYoY), unit: '%', sub: 'YoY', tone: toneLow(aheYoY, 3.2, 2.5), points: spark(aheYoYObs), ...hist(aheYoYObs) },
    { label: 'Real Wage Growth', value: real != null ? `${real >= 0 ? '+' : ''}${real.toFixed(1)}%` : '—', sub: 'wages minus inflation', tone: toneLow(real, 0, -1) },
  ]
  return { key: 'wages', label: 'Wage Growth', status, tone, signals, metrics }
}

// ── Overall status — dominant trend, layoffs weighted heaviest ──────────
export type LaborStatus = { emoji: string; label: string; tone: Tone }
const TONE_RANK: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3, crisis: 4 }
const TONE_EMOJI: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }
const PRIORITY = ['layoff', 'hiring', 'employment', 'wages']

function pickWorst(cats: Category[]): Category {
  return [...cats].sort((a, b) => {
    const r = TONE_RANK[b.tone] - TONE_RANK[a.tone]
    return r !== 0 ? r : PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)
  })[0]
}

function overallStatus(cats: Category[], sahmTriggered: boolean): LaborStatus {
  const by: Record<string, Category> = Object.fromEntries(cats.map(c => [c.key, c]))
  // The headline tracks the JOB market — employment, hiring, layoffs (layoff
  // weighted heaviest). Wage growth is explanatory: it can cool the headline to
  // at most 'neutral', but never drive it into softening/stress on its own.
  const worst = pickWorst(cats.filter(c => c.key !== 'wages'))
  let tone = worst?.tone ?? 'good'
  const wages = by.wages
  if (wages && TONE_RANK[wages.tone] >= 2 && TONE_RANK[tone] < 1) tone = 'neutral'
  let label: string
  if (tone === 'crisis') label = sahmTriggered ? 'Rapid Deterioration' : 'Labor Market Warning'
  else if (tone === 'bad') label = worst.key === 'layoff' ? 'Layoff Risk Rising' : worst.key === 'employment' ? 'Employment Deteriorating' : 'Labor Market Stress'
  else if (tone === 'warn') label = worst.key === 'hiring' ? 'Hiring Weakness Emerging' : worst.key === 'employment' ? 'Job Growth Slowing' : 'Labor Softening'
  else if (tone === 'neutral') label = worst.key === 'hiring' ? 'Hiring Slowing' : 'Cooling Labor Market'
  else label = worst.key === 'hiring' ? 'Strong Hiring' : worst.key === 'employment' ? 'Broad Employment Growth' : 'Healthy Labor Market'
  return { emoji: TONE_EMOJI[tone], label, tone }
}

// ── "Workers Are Experiencing" — the human-readable takeaway ────────────
export type Experience = { tone: Tone; text: string }
function buildExperience(tone: Tone): Experience {
  const text = tone === 'good' ? 'Strong Job Market'
    : tone === 'neutral' ? 'Stable Employment, Slower Hiring'
    : tone === 'warn' ? 'Fewer Opportunities Available'
    : tone === 'bad' ? 'Rising Layoffs, Harder to Find Work'
    : 'Widespread Job Losses'
  return { tone, text }
}

// ── Alerts (separate from status) ───────────────────────────────────────
export type LaborAlert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }

function buildAlerts(d: LaborData, cats: Category[]): LaborAlert[] {
  const alerts: LaborAlert[] = []
  const unemp = d.unrate[0]?.value ?? null
  const icK = d.icsa[0]?.value != null ? d.icsa[0].value / 1000 : null
  const cc = d.ccsa[0]?.value ?? null
  const pc = d.payems.length >= 2 ? d.payems[0].value - d.payems[1].value : null
  const sahm = sahmGap(d.unrate)
  const openings = d.jolts[0]?.value ?? null
  const openingsMin = d.jolts.length ? Math.min(...d.jolts.map(o => o.value)) : null

  if (sahm != null && sahm >= 0.5) {
    alerts.push({
      id: 'sahm', title: 'Sahm Rule Triggered',
      what: `The 3-month average unemployment rate is ${sahm.toFixed(1)}pp above its 12-month low.`,
      why: 'The Sahm Rule — a half-point rise in unemployment from its low — has marked the start of every U.S. recession since the 1970s. It signals the labor market may be entering a self-reinforcing downturn.',
      affected: ['Consumer Spending', 'Stock Market', 'Housing', 'Household Income'],
      context: 'A reliable real-time recession indicator; it has very few false positives historically.',
    })
  }
  if (unemp != null && unemp >= 5) {
    alerts.push({
      id: 'unemp-5', title: 'Unemployment Above 5%',
      what: `The unemployment rate has risen to ${fPct(unemp)}.`,
      why: 'Unemployment above 5% means a meaningful share of workers can’t find jobs, cutting household income and consumer spending — the economy’s main engine.',
      affected: ['Consumer Spending', 'Household Income', 'Credit', 'Government Finances'],
      context: 'A sustained move above 5% from a low base is historically associated with recession.',
    })
  }
  if (icK != null && icK >= 300) {
    alerts.push({
      id: 'claims-high', title: 'Initial Jobless Claims Elevated',
      what: `Initial claims are running at ${Math.round(icK)}k per week.`,
      why: 'A sustained rise in initial claims is one of the earliest signals that employers have shifted from hiring to cutting — it leads the unemployment rate.',
      affected: ['Consumer Spending', 'Stock Market', 'Household Income'],
      context: 'Claims durably above ~300k/week have preceded past labor-market downturns.',
    })
  }
  if (cc != null && cc >= 2_000_000) {
    alerts.push({
      id: 'cc-stress', title: 'Continuing Claims in the Stress Zone',
      what: `Continuing claims have reached ${fClaimsMil(cc)}.`,
      why: 'Rising continuing claims mean the newly unemployed are taking longer to find work — a sign hiring is no longer absorbing job losers.',
      affected: ['Household Income', 'Consumer Spending', 'Credit'],
      context: 'Climbing continuing claims typically confirm a weakening already hinted at by initial claims.',
    })
  }
  if (pc != null && pc < 50) {
    alerts.push({
      id: 'payroll-slow', title: 'Payroll Growth Below Slowdown Threshold',
      what: `Payrolls ${pc >= 0 ? `added just ${Math.round(pc)}k` : `lost ${Math.abs(Math.round(pc))}k`} jobs last month.`,
      why: 'Job growth below ~50k/month is too slow to keep pace with population growth, meaning the labor market is no longer expanding.',
      affected: ['Consumer Spending', 'Household Income', 'Stock Market'],
      context: 'The economy needs roughly 75–100k jobs a month just to hold unemployment steady.',
    })
  }
  if (openings != null && openingsMin != null && openings <= openingsMin * 1.02) {
    alerts.push({
      id: 'jolts-low', title: 'Job Openings at a Cycle Low',
      what: `Job openings have fallen to ${fMil(openings)}, the lowest in the fetched record.`,
      why: 'Falling openings show employer demand for workers is drying up — the early stage of a hiring slowdown that often precedes rising unemployment.',
      affected: ['Household Income', 'Consumer Spending', 'Stock Market'],
      context: 'A steep drop in openings led the labor cooling of 2007 and 2001.',
    })
  }
  return alerts
}

// ── Watching closely (never empty) ─────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number; key: string }

function buildWatching(d: LaborData, alerts: LaborAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []
  const unemp = d.unrate[0]?.value ?? null
  const icK = d.icsa[0]?.value != null ? d.icsa[0].value / 1000 : null
  const pc = d.payems.length >= 2 ? d.payems[0].value - d.payems[1].value : null
  const openings = d.jolts[0]?.value ?? null
  const openingsMin = d.jolts.length ? Math.min(...d.jolts.map(o => o.value)) : null

  if (icK != null && !firing.has('claims-high')) {
    items.push({ label: 'Initial Jobless Claims', text: `${Math.round(300 - icK)}k from the 300k alert threshold`, proximity: Math.max(0, Math.min(1, icK / 300)), key: 'layoff' })
  }
  if (unemp != null && !firing.has('unemp-5')) {
    items.push({ label: 'Unemployment Rate', text: `${(5 - unemp).toFixed(1)}% from the 5% alert level`, proximity: Math.max(0, Math.min(1, unemp / 5)), key: 'employment' })
  }
  if (pc != null && !firing.has('payroll-slow')) {
    items.push({ label: 'Payroll Growth', text: pc <= 50 ? 'at the 50k slowdown trigger' : `${Math.round(pc - 50)}k above the 50k slowdown trigger`, proximity: Math.max(0, Math.min(1, 50 / Math.max(pc, 1))), key: 'employment' })
  }
  if (openings != null && openingsMin != null && !firing.has('jolts-low')) {
    const overLow = parseFloat(((openings / openingsMin - 1) * 100).toFixed(0))
    items.push({ label: 'Job Openings', text: `${overLow}% above the cycle low`, proximity: Math.max(0, Math.min(1, openingsMin / openings)), key: 'hiring' })
  }
  return items.sort((a, b) => b.proximity - a.proximity).slice(0, 5)
}

// ── Biggest risk / biggest stabilizer ──────────────────────────────────
const RISK_PHRASE: Record<string, string> = {
  'layoff:Labor Warning': 'Layoffs are surging — jobless claims have spiked to recessionary levels.',
  'layoff:Layoff Pressure': 'Layoff activity is climbing as jobless claims push higher.',
  'layoff:Rising Layoffs': 'Jobless claims are creeping up, an early sign employers are starting to cut.',
  'employment:Weakening': 'Job growth has stalled and unemployment is rising.',
  'employment:Slowing': 'Hiring has slowed and payroll growth is fading.',
  'hiring:Weak Demand': 'Employer demand for workers has dried up — there are now more job-seekers than openings.',
  'hiring:Cooling Demand': 'Hiring demand continues to soften and job openings remain on a downward trend.',
  'wages:Weak': 'Inflation is eroding paychecks — workers are losing real spending power.',
  'wages:Slowing': 'Wage growth is fading and barely keeping up with inflation.',
}
const STAB_PHRASE: Record<string, string> = {
  'layoff:Low Layoff Risk': 'Layoff activity remains below historical recessionary levels.',
  'layoff:Watchlist': 'Layoffs remain contained for now.',
  'employment:Strong Growth': 'Employers are still adding jobs at a healthy clip.',
  'employment:Healthy': 'Employment remains healthy and unemployment is low.',
  'hiring:Strong Demand': 'Employer demand for workers remains strong.',
  'hiring:Healthy Hiring': 'Hiring remains healthy with openings outnumbering job-seekers.',
  'wages:Strong Wage Growth': 'Workers are gaining real ground as wages outpace inflation.',
  'wages:Healthy': 'Wages are comfortably outpacing inflation.',
}
const STAB_PREF = ['layoff', 'employment', 'hiring', 'wages']

const RISK_WHY: Record<string, string> = {
  employment: 'When job growth stalls and unemployment climbs, household income falls and people pull back on spending — which can feed on itself into a downturn.',
  hiring: 'Hiring weakens before layoffs hit: when employers stop posting jobs, the people who lose work can’t find new jobs, and unemployment starts to climb.',
  layoff: 'Layoffs are the clearest sign conditions are deteriorating — rising claims mean more people are suddenly without income and cutting back fast.',
  wages: 'When paychecks don’t keep up with prices, workers lose buying power and consumer spending — the economy’s biggest engine — weakens.',
}
const STAB_WHY: Record<string, string> = {
  employment: 'Steady job creation keeps incomes flowing and supports consumer spending.',
  hiring: 'Healthy hiring demand means people who lose jobs can quickly find new ones.',
  layoff: 'Low layoffs mean few people are suddenly losing their income — the labor market’s key shock absorber.',
  wages: 'Wages outpacing inflation means workers are getting ahead, supporting spending.',
}

export type Callout = { text: string; why: string; key: string }

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: Callout; stabilizer: Callout } {
  const worst = pickWorst(cats)
  const useWatch = !(worst && TONE_RANK[worst.tone] >= 2)
  const riskText = !useWatch
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label}: ${worst.status.toLowerCase()}.`)
    : watching[0] ? `${watching[0].label} approaching its alert — ${watching[0].text}.` : 'No major labor-market risks building right now.'
  const riskKey = useWatch ? (watching[0]?.key ?? worst?.key ?? '') : worst.key

  const goods = cats.filter(c => c.tone === 'good')
  let best: Category | undefined
  if (goods.length) {
    best = [...goods].sort((a, b) => STAB_PREF.indexOf(a.key) - STAB_PREF.indexOf(b.key))[0]
  } else {
    best = [...cats].filter(c => c.key !== riskKey)
      .sort((a, b) => (TONE_RANK[a.tone] - TONE_RANK[b.tone]) || (STAB_PREF.indexOf(a.key) - STAB_PREF.indexOf(b.key)))[0]
  }
  const stabText = !best ? 'No clear stabilizers right now.'
    : best.tone === 'good' ? (STAB_PHRASE[`${best.key}:${best.status}`] ?? `${best.label} is holding steady.`)
    : `${best.label} is the least-pressing area right now, though no category is a firm stabilizer yet.`
  return {
    risk: { text: riskText, why: RISK_WHY[riskKey] ?? '', key: riskKey },
    stabilizer: { text: stabText, why: STAB_WHY[best?.key ?? ''] ?? '', key: best?.key ?? '' },
  }
}

function buildLastAlert(d: LaborData): string | null {
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const claim = d.icsa.find(o => o.value >= 300000)
  const unemp = d.unrate.find(o => o.value >= 5)
  const candidates: { date: string; text: string }[] = []
  if (claim) candidates.push({ date: claim.date, text: `Initial jobless claims last exceeded 300k on ${fmtDate(claim.date)}.` })
  if (unemp) candidates.push({ date: unemp.date, text: `Unemployment was last at or above 5% in ${new Date(unemp.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}.` })
  if (candidates.length) return candidates.sort((a, b) => +new Date(b.date) - +new Date(a.date))[0].text
  if (d.icsa.length) {
    let peak = d.icsa[0]
    for (const o of d.icsa) if (o.value > peak.value) peak = o
    return `Labor market calm — initial claims peaked at ${Math.round(peak.value / 1000)}k in ${new Date(peak.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} and have eased since.`
  }
  return null
}

// ── Summary generator (75–125 words, deterministic) ─────────────────────
function buildSummary(d: LaborData, cats: Category[], risk: Callout): string {
  const by: Record<string, Category> = Object.fromEntries(cats.map(c => [c.key, c]))
  const unemp = d.unrate[0]?.value ?? null
  const pc = d.payems.length >= 2 ? d.payems[0].value - d.payems[1].value : null
  const hiring = by.hiring, layoff = by.layoff, wages = by.wages

  const dir = hiring?.tone === 'good' && layoff?.tone === 'good' ? 'remains healthy'
    : layoff?.tone === 'bad' || layoff?.tone === 'crisis' ? 'is deteriorating as layoffs climb'
    : 'remains stable but continues to cool from recent highs'
  const s1 = `The labor market ${dir}${unemp != null ? `, with unemployment at ${fPct(unemp)}` : ''}.`
  const s2 = pc != null
    ? `Employers ${pc > 0 ? `are still adding workers (${Math.round(pc)}k last month)` : 'cut jobs last month'}, though hiring demand has ${hiring?.tone === 'good' ? 'stayed firm' : 'softened and job openings have declined'}.`
    : ''
  const s3 = layoff?.tone === 'good'
    ? 'Layoff activity remains relatively contained, preventing broader labor-market deterioration.'
    : 'Layoff activity is picking up, raising the risk of broader weakness.'
  const s4 = wages?.tone === 'bad' ? 'Wage growth is no longer keeping up with inflation, eroding real incomes.'
    : wages?.tone === 'good' ? 'Wages continue to outpace inflation, supporting worker incomes.'
    : 'Wage growth remains positive but has slowed from peak levels.'
  // What it means next — the lever readers actually feel.
  const s5 = layoff?.tone === 'good' && (hiring?.tone === 'good' || hiring?.tone === 'neutral')
    ? 'For now, low layoffs are keeping the job market on solid footing even as hiring momentum fades.'
    : 'If hiring demand keeps weakening, it could eventually translate into rising unemployment and increased layoff activity.'
  const s6 = `The primary risk: ${risk.text.charAt(0).toLowerCase()}${risk.text.slice(1)}`
  return [s1, s2, s3, s4, s5, s6].filter(Boolean).join(' ')
}

// ── Public entry point ──────────────────────────────────────────────────
export type LaborModel = {
  available: boolean
  status: LaborStatus
  subtitle: string
  summary: string
  experience: Experience
  risk: Callout
  stabilizer: Callout
  categories: Category[]
  alerts: LaborAlert[]
  lastAlert: string | null
  watching: WatchItem[]
}

const SUBTITLES: Record<string, string> = {
  'Strong Hiring': 'Employers are hiring briskly and jobs are plentiful.',
  'Healthy Labor Market': 'Jobs are steady, hiring is solid, and layoffs are low.',
  'Broad Employment Growth': 'Employment is growing across the board.',
  'Stable Employment': 'Employment is steady even as momentum cools.',
  'Hiring Slowing': 'Jobs are holding up, but hiring demand is easing.',
  'Cooling Labor Market': 'The job market is gradually losing momentum.',
  'Labor Softening': 'Cracks are forming — hiring and employment are softening.',
  'Hiring Weakness Emerging': 'Employer demand for workers is fading.',
  'Job Growth Slowing': 'Payroll growth is slowing toward stall speed.',
  'Layoff Risk Rising': 'Layoffs are climbing — labor stress is building.',
  'Employment Deteriorating': 'Jobs are being lost and unemployment is rising.',
  'Labor Market Stress': 'The labor market is under real stress.',
  'Labor Market Warning': 'Severe labor-market weakness is emerging.',
  'Rapid Deterioration': 'The labor market is deteriorating quickly.',
  'Recession-Level Weakness': 'Labor conditions are at recessionary levels.',
  'Data Unavailable': 'Live labor-market data is temporarily unavailable.',
}

export async function buildLaborModel(): Promise<LaborModel> {
  const data = await fetchLaborData()

  // Unemployment is the keystone — if it's missing, don't fabricate a status.
  if (data.unrate[0]?.value == null) {
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      summary: 'Live labor-market data is temporarily unavailable. Check back shortly.',
      experience: { tone: 'neutral', text: 'Data unavailable' },
      risk: { text: '', why: '', key: '' }, stabilizer: { text: '', why: '', key: '' },
      categories: [], alerts: [], lastAlert: null, watching: [],
    }
  }

  const categories = [scoreEmployment(data), scoreHiring(data), scoreLayoff(data), scoreWages(data)].map(withFill)
  const sahm = sahmGap(data.unrate)
  const status = overallStatus(categories, sahm != null && sahm >= 0.5)
  const alerts = buildAlerts(data, categories)
  const watching = buildWatching(data, alerts)
  const { risk, stabilizer } = riskAndStabilizer(categories, watching)

  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    summary: buildSummary(data, categories, risk),
    experience: buildExperience(status.tone),
    risk, stabilizer, categories, alerts,
    lastAlert: buildLastAlert(data),
    watching,
  }
}
