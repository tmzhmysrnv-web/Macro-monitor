// lib/credit.ts
// Credit-market intelligence model. Answers one question: "are lenders becoming
// more fearful?". Four themes — Lending Conditions, Corporate Credit Health,
// Consumer Credit Health, Financial System Stress — each scored on real FRED
// data; the overall Credit Status is the dominant signal among them.
//
// Metric notes (no free real-time public source):
//   Distressed-debt ratio / bankruptcy filings -> omitted; HY spread proxies default risk
//   Mortgage credit availability (MBA)          -> omitted (not free)
//   Regional-bank / bank stress indicators      -> proxied via NFCI + CRE delinquency

import { fredFetch } from './fred'

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

function valueDaysBack(obs: Obs[], days: number): number | null {
  if (!obs.length) return null
  const target = new Date(obs[0].date)
  target.setDate(target.getDate() - days)
  for (const o of obs) if (new Date(o.date) <= target) return o.value
  return null
}
function pctChange(latest: number | null, past: number | null): number | null {
  if (latest == null || past == null || past === 0) return null
  return parseFloat(((latest - past) / Math.abs(past) * 100).toFixed(1))
}

export type Metric = { latest: number | null; yoyPct: number | null; chg3m: number | null; obs: Obs[] }
function metricOf(obs: Obs[]): Metric {
  const latest = obs[0]?.value ?? null
  const back3m = valueDaysBack(obs, 91)
  return {
    latest,
    yoyPct: pctChange(latest, valueDaysBack(obs, 365)),
    chg3m: latest != null && back3m != null ? parseFloat((latest - back3m).toFixed(2)) : null,
    obs,
  }
}

// ── shared card helpers (sparkline + historical percentile + alert distance) ──
export type MetricCard = {
  label: string; value: string; sub?: string; unit?: string
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
function alertAbove(value: number | null, threshold: number, unit = '%'): { alertText?: string; alertProximity?: number } {
  if (value == null || value >= threshold) return {}
  return { alertText: `${(threshold - value).toFixed(2)}${unit} from ${threshold}${unit} alert`, alertProximity: Math.max(0, Math.min(1, value / threshold)) }
}

const fPct = (v: number | null, d = 2) => v == null ? '—' : `${v.toFixed(d)}%`
const fNet = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}%`
const fIdx = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const subYoY = (m: Metric) => m.yoyPct == null ? undefined : `${m.yoyPct >= 0 ? '+' : ''}${m.yoyPct}% YoY`

export type CreditData = {
  standards: Metric       // DRTSCILM — net % of banks tightening C&I standards
  ciLoans: Metric         // BUSLOANS — C&I loans (YoY growth)
  consumerLoans: Metric   // CONSUMER — consumer loans (YoY growth)
  hy: Metric              // BAMLH0A0HYM2 — high-yield spread
  ig: Metric              // BAMLC0A0CM — investment-grade spread
  ccDelinq: Metric        // DRCCLACBS — credit-card delinquency rate
  chargeOff: Metric       // CORCCACBS — credit-card charge-off rate
  debtService: Metric     // TDSP — household debt-service ratio
  nfci: Metric            // NFCI — Chicago Fed financial conditions
  creDelinq: Metric       // DRCRELEXFACBS — CRE delinquency rate
  ccDelinqMax: number | null // cycle-high reference
}

export async function fetchCreditData(): Promise<CreditData> {
  const [std, ci, cons, hy, ig, cc, co, dsr, nfci, cre] = await Promise.all([
    fredSeries('DRTSCILM', 90),    // quarterly, ~22y
    fredSeries('BUSLOANS', 140),   // monthly, ~11y (YoY + sparkline)
    fredSeries('CONSUMER', 140),
    fredSeries('BAMLH0A0HYM2', 1300), // daily ~5y
    fredSeries('BAMLC0A0CM', 1300),
    fredSeries('DRCCLACBS', 52),   // quarterly, ~13y — excludes the 2009 GFC spike so
    fredSeries('CORCCACBS', 52),   // "cycle high" + percentile reflect THIS cycle
    fredSeries('TDSP', 90),
    fredSeries('NFCI', 540),       // weekly ~10y
    fredSeries('DRCRELEXFACBS', 52),
  ])
  return {
    standards: metricOf(std),
    ciLoans: metricOf(ci),
    consumerLoans: metricOf(cons),
    hy: metricOf(hy),
    ig: metricOf(ig),
    ccDelinq: metricOf(cc),
    chargeOff: metricOf(co),
    debtService: metricOf(dsr),
    nfci: metricOf(nfci),
    creDelinq: metricOf(cre),
    ccDelinqMax: cc.length ? Math.max(...cc.map(o => o.value)) : null,
  }
}

// ── Category scoring ──────────────────────────────────────────────────
export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
export type Category = {
  key: string; label: string; status: string; tone: Tone; fill: number
  signals: string[]; metrics: MetricCard[]
}
const TONE_FILL: Record<Tone, number> = { good: 0.9, neutral: 0.55, warn: 0.4, bad: 0.18, crisis: 0.08 }
function withFill(c: Omit<Category, 'fill'>): Category { return { ...c, fill: TONE_FILL[c.tone] } }

// 1 ── Lending Conditions (are banks becoming more restrictive?) ───────
function scoreLending(d: CreditData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const std = d.standards.latest, ci = d.ciLoans.yoyPct, cons = d.consumerLoans.yoyPct
  if (std != null) signals.push(`Banks reporting a net ${std > 0 ? `+${std.toFixed(0)}% tightening` : `${std.toFixed(0)}% easing`} of C&I lending standards (SLOOS)`)
  if (ci != null) signals.push(`Business (C&I) loans ${ci >= 0 ? 'growing' : 'contracting'} ${Math.abs(ci)}% YoY`)
  if (cons != null) signals.push(`Consumer loans ${cons >= 0 ? 'growing' : 'contracting'} ${Math.abs(cons)}% YoY`)

  const contracting = (ci != null && ci <= -3) || (cons != null && cons <= -3)
  let status: string, tone: Tone
  if ((std != null && std >= 30) || contracting) { status = 'Restrictive'; tone = 'bad' }
  else if (std != null && std >= 12) { status = 'Tightening'; tone = 'warn' }
  else if (std != null && std <= -5 && (ci == null || ci > 1)) { status = 'Easy Credit'; tone = 'good' }
  else if (std != null && std <= 5) { status = 'Healthy Lending'; tone = 'good' }
  else { status = 'Normal'; tone = 'neutral' }

  const metrics: MetricCard[] = [
    { label: 'Bank Lending Standards', value: fNet(std), sub: 'net tightening (SLOOS)', points: spark(d.standards.obs), ...hist(d.standards.obs) },
    { label: 'Business Loan Growth', value: fPct(d.ciLoans.yoyPct, 1), unit: '%', sub: 'C&I, YoY', points: spark(d.ciLoans.obs) },
    { label: 'Consumer Loan Growth', value: fPct(d.consumerLoans.yoyPct, 1), unit: '%', sub: 'YoY', points: spark(d.consumerLoans.obs) },
  ]
  return { key: 'lending', label: 'Lending Conditions', status, tone, signals, metrics }
}

// 2 ── Corporate Credit Health (are companies riskier borrowers?) ──────
function scoreCorporate(d: CreditData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const hy = d.hy.latest, ig = d.ig.latest
  if (hy != null) signals.push(`High-yield spread at ${fPct(hy)} — ${hy >= 6 ? 'pricing real default risk' : hy >= 4 ? 'somewhat elevated' : 'tight; credit markets calm'}`)
  if (ig != null) signals.push(`Investment-grade spread at ${fPct(ig)}`)
  if (d.hy.chg3m != null) signals.push(`HY spread ${d.hy.chg3m >= 0 ? 'widened' : 'tightened'} ${Math.abs(d.hy.chg3m)}pp over 3 months`)

  let status: string, tone: Tone
  if (hy != null && hy >= 8) { status = 'Distress Accelerating'; tone = 'crisis' }
  else if (hy != null && hy >= 6) { status = 'Stress Emerging'; tone = 'bad' }
  else if (hy != null && hy >= 5) { status = 'Rising Risk'; tone = 'warn' }
  else if (hy != null && hy >= 4) { status = 'Watchlist'; tone = 'neutral' }
  else if (hy != null && hy >= 3) { status = 'Stable'; tone = 'good' }
  else { status = 'Healthy'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'High-Yield Spread', value: fPct(hy), unit: '%', points: spark(d.hy.obs), ...hist(d.hy.obs), ...alertAbove(hy, 5), sub: d.hy.chg3m != null ? `${d.hy.chg3m >= 0 ? '+' : ''}${d.hy.chg3m}pp 3mo` : undefined },
    { label: 'Investment-Grade Spread', value: fPct(ig), unit: '%', points: spark(d.ig.obs), ...hist(d.ig.obs) },
  ]
  return { key: 'corporate', label: 'Corporate Credit Health', status, tone, signals, metrics }
}

// 3 ── Consumer Credit Health (are households struggling with debt?) ───
function scoreConsumer(d: CreditData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const cc = d.ccDelinq.latest, ccYoY = d.ccDelinq.yoyPct, co = d.chargeOff.latest, dsr = d.debtService.latest
  if (cc != null) signals.push(`Credit-card delinquencies at ${fPct(cc)}${ccYoY != null ? ` (${ccYoY >= 0 ? '+' : ''}${ccYoY}% YoY)` : ''}`)
  if (co != null) signals.push(`Card charge-offs at ${fPct(co)}`)
  if (dsr != null) signals.push(`Household debt service at ${dsr.toFixed(1)}% of disposable income`)

  let status: string, tone: Tone
  if (cc != null && cc >= 7) { status = 'Consumer Credit Event'; tone = 'crisis' }
  else if ((cc != null && cc >= 5) || (co != null && co >= 6)) { status = 'Financial Stress'; tone = 'bad' }
  else if ((ccYoY != null && ccYoY >= 15) || (cc != null && cc >= 3.5)) { status = 'Deteriorating'; tone = 'warn' }
  else if (ccYoY != null && ccYoY >= 5) { status = 'Watchlist'; tone = 'neutral' }
  else { status = 'Stable'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'Card Delinquencies', value: fPct(cc), unit: '%', points: spark(d.ccDelinq.obs), ...hist(d.ccDelinq.obs), sub: subYoY(d.ccDelinq) },
    { label: 'Card Charge-Offs', value: fPct(co), unit: '%', points: spark(d.chargeOff.obs), ...hist(d.chargeOff.obs) },
    { label: 'Debt Service Ratio', value: dsr != null ? `${dsr.toFixed(1)}%` : '—', unit: '%', sub: 'of income', points: spark(d.debtService.obs), ...hist(d.debtService.obs) },
  ]
  return { key: 'consumer', label: 'Consumer Credit Health', status, tone, signals, metrics }
}

// 4 ── Financial System Stress (is fear spreading through the system?) ─
function scoreFinancial(d: CreditData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const nfci = d.nfci.latest, cre = d.creDelinq.latest
  if (nfci != null) signals.push(`Financial conditions ${nfci > 0 ? `tighter than average (NFCI +${nfci.toFixed(2)})` : `looser than average (NFCI ${nfci.toFixed(2)})`}`)
  if (cre != null) signals.push(`Commercial real-estate delinquencies at ${fPct(cre)}${d.creDelinq.yoyPct != null ? ` (${d.creDelinq.yoyPct >= 0 ? '+' : ''}${d.creDelinq.yoyPct}% YoY)` : ''}`)

  const creHot = cre != null && cre >= 2 && (d.creDelinq.yoyPct == null || d.creDelinq.yoyPct >= 10)
  let status: string, tone: Tone
  if (nfci != null && nfci >= 1.0) { status = 'Credit Event Risk'; tone = 'crisis' }
  else if ((nfci != null && nfci >= 0.4) || (cre != null && cre >= 3)) { status = 'Systemic Stress'; tone = 'bad' }
  else if ((nfci != null && nfci >= 0) || creHot) { status = 'Elevated Stress'; tone = 'warn' }
  else if (nfci != null && nfci >= -0.3) { status = 'Watchlist'; tone = 'neutral' }
  else { status = 'Stable'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'Financial Conditions', value: fIdx(nfci), sub: 'NFCI · 0 = average', points: spark(d.nfci.obs), ...hist(d.nfci.obs) },
    { label: 'CRE Delinquencies', value: fPct(cre), unit: '%', points: spark(d.creDelinq.obs), ...hist(d.creDelinq.obs), sub: subYoY(d.creDelinq) },
  ]
  return { key: 'financial', label: 'Financial System Stress', status, tone, signals, metrics }
}

// ── Overall status — the dominant signal ──────────────────────────────
export type CreditStatus = { emoji: string; label: string; tone: Tone }
const TONE_RANK: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3, crisis: 4 }
const TONE_EMOJI: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }
// Headline label per dominant tone (the spec's overall outputs).
const OVERALL_LABEL: Record<Tone, string> = {
  good: 'Healthy Lending', neutral: 'Selective Lending', warn: 'Tightening Conditions',
  bad: 'Credit Stress', crisis: 'Credit Crunch',
}
// Tie-break when themes share the worst tone — most systemic first.
const PRIORITY = ['financial', 'corporate', 'consumer', 'lending']

function overallStatus(cats: Category[]): CreditStatus {
  const worst = [...cats].sort((a, b) => {
    const r = TONE_RANK[b.tone] - TONE_RANK[a.tone]
    return r !== 0 ? r : PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)
  })[0]
  const tone = worst?.tone ?? 'good'
  return { emoji: TONE_EMOJI[tone], label: OVERALL_LABEL[tone], tone }
}

// ── Alerts ────────────────────────────────────────────────────────────
export type CreditAlert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }

function monthsSinceHyAbove(obs: Obs[], level: number): number | null {
  if (obs.length < 2) return null
  const latest = new Date(obs[0].date)
  for (let i = 1; i < obs.length; i++) {
    if (obs[i].value >= level) return Math.round((latest.getTime() - new Date(obs[i].date).getTime()) / (1000 * 60 * 60 * 24 * 30.4))
  }
  return null
}

function buildAlerts(d: CreditData): CreditAlert[] {
  const alerts: CreditAlert[] = []
  const hy = d.hy.latest

  if (hy != null && hy >= 7) {
    alerts.push({
      id: 'hy-7', title: 'High-Yield Spread Above 7%',
      what: `The high-yield spread is at ${fPct(hy)}.`,
      why: 'Spreads above 7% mean investors are demanding heavy compensation to lend to riskier companies — a classic sign of credit stress and rising default expectations.',
      affected: ['Business Investment', 'Stock Market', 'Banking System', 'Labor'],
      context: 'Sustained spreads above 7% have accompanied every major credit event of the past 25 years.',
    })
  } else if (hy != null && hy >= 5) {
    const m = monthsSinceHyAbove(d.hy.obs.slice(1), 5)
    alerts.push({
      id: 'hy-5', title: 'High-Yield Spread Above 5%',
      what: `The high-yield spread is at ${fPct(hy)}.`,
      why: 'Widening high-yield spreads show lenders repricing corporate risk and pulling back from riskier borrowers.',
      affected: ['Business Investment', 'Stock Market', 'Banking System'],
      context: m != null ? `First break above 5% in ${m} months.` : 'A level not seen in the past few years.',
    })
  }

  const cc = d.ccDelinq.latest
  if (cc != null && d.ccDelinqMax != null && cc >= d.ccDelinqMax - 0.05 && (d.ccDelinq.yoyPct == null || d.ccDelinq.yoyPct >= 0)) {
    alerts.push({
      id: 'cc-high', title: 'Credit-Card Delinquencies at a Cycle High',
      what: `Card delinquencies are at ${fPct(cc)}, the highest in the fetched record.`,
      why: 'Rising card delinquencies are an early, direct signal that households are running out of room to service debt.',
      affected: ['Consumer Spending', 'Banking System', 'Labor'],
      context: 'Consumer delinquencies typically lead broader credit stress by several quarters.',
    })
  }

  if (d.nfci.latest != null && d.nfci.latest >= 0.3) {
    alerts.push({
      id: 'nfci-tight', title: 'Financial Conditions Turned Restrictive',
      what: `The Chicago Fed NFCI is at +${d.nfci.latest.toFixed(2)} (above 0 = tighter than average).`,
      why: 'A positive NFCI means credit and funding conditions across the financial system are tighter than normal — fear is spreading beyond any single market.',
      affected: ['Banking System', 'Business Investment', 'Housing', 'Stock Market'],
      context: 'The NFCI rose sharply ahead of the 2008 and 2020 stress episodes.',
    })
  }

  if (d.creDelinq.latest != null && d.creDelinq.latest >= 3) {
    alerts.push({
      id: 'cre-distress', title: 'Commercial Real-Estate Distress Building',
      what: `CRE loan delinquencies are at ${fPct(d.creDelinq.latest)}.`,
      why: 'Rising CRE delinquencies strain regional banks that concentrate in commercial property lending — a known fault line in the banking system.',
      affected: ['Banking System', 'Business Investment'],
      context: 'CRE stress was central to the 2023 regional-bank failures.',
    })
  }

  return alerts
}

// ── Watching closely (never empty) ────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number }

function buildWatching(d: CreditData, alerts: CreditAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []

  if (d.hy.latest != null && !firing.has('hy-5') && !firing.has('hy-7')) {
    items.push({ label: 'High-Yield Spread', text: `${(5 - d.hy.latest).toFixed(2)}% from the 5% stress alert`, proximity: Math.max(0, Math.min(1, d.hy.latest / 5)) })
  }
  if (d.ccDelinq.latest != null && !firing.has('cc-high')) {
    items.push({ label: 'Card Delinquencies', text: `${(4 - d.ccDelinq.latest).toFixed(2)}% from the 4% warning level`, proximity: Math.max(0, Math.min(1, d.ccDelinq.latest / 4)) })
  }
  if (d.nfci.latest != null && !firing.has('nfci-tight')) {
    const dist = parseFloat((0 - d.nfci.latest).toFixed(2))
    items.push({ label: 'Financial Conditions', text: `${dist > 0 ? `${dist} below` : `${Math.abs(dist)} into`} the restrictive zone (NFCI 0)`, proximity: Math.max(0, Math.min(1, (d.nfci.latest + 1) / 1)) })
  }
  if (d.standards.latest != null && d.standards.latest < 30) {
    items.push({ label: 'Lending Standards', text: `${(30 - d.standards.latest).toFixed(0)}pp from the sharp-tightening alert`, proximity: Math.max(0, Math.min(1, (d.standards.latest + 20) / 50)) })
  }
  if (d.creDelinq.latest != null && !firing.has('cre-distress')) {
    items.push({ label: 'CRE Delinquencies', text: `${(3 - d.creDelinq.latest).toFixed(2)}% from the distress threshold`, proximity: Math.max(0, Math.min(1, d.creDelinq.latest / 3)) })
  }

  return items.sort((a, b) => b.proximity - a.proximity).slice(0, 5)
}

// ── Biggest risk / biggest stabilizer ─────────────────────────────────
const RISK_PHRASE: Record<string, string> = {
  'corporate:Distress Accelerating': 'Corporate defaults are accelerating as high-yield spreads blow out.',
  'corporate:Stress Emerging': 'Widening high-yield spreads show corporate credit stress emerging.',
  'corporate:Rising Risk': 'High-yield spreads are widening as investors reprice corporate risk.',
  'consumer:Consumer Credit Event': 'Household credit stress has reached crisis levels.',
  'consumer:Financial Stress': 'Consumer delinquencies and charge-offs are climbing into stress territory.',
  'consumer:Deteriorating': 'Rising card delinquencies show households under growing strain.',
  'lending:Restrictive': 'Banks have sharply pulled back, restricting access to credit.',
  'lending:Tightening': 'Banks are tightening lending standards and slowing loan growth.',
  'financial:Credit Event Risk': 'System-wide financial conditions are flashing credit-event risk.',
  'financial:Systemic Stress': 'Financial conditions are tightening across the system.',
  'financial:Elevated Stress': 'Financial-system stress is building beneath the surface.',
}
const STAB_PHRASE: Record<string, string> = {
  'corporate:Healthy': 'Corporate credit is calm — high-yield spreads remain tight.',
  'corporate:Stable': 'Corporate credit markets remain stable.',
  'consumer:Stable': 'Consumer delinquencies remain below stress levels.',
  'lending:Easy Credit': 'Banks are still lending freely.',
  'lending:Healthy Lending': 'Lending conditions remain healthy.',
  'lending:Normal': 'Lending conditions are roughly normal.',
  'financial:Stable': 'System-wide financial conditions remain loose and orderly.',
  'financial:Watchlist': 'Financial-system stress is contained for now.',
}
const STAB_PREF = ['corporate', 'financial', 'consumer', 'lending']

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: string; stabilizer: string } {
  const worst = [...cats].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone])[0]
  const risk = worst && TONE_RANK[worst.tone] >= 2
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label}: ${worst.status.toLowerCase()}.`)
    : watching[0] ? `${watching[0].label} approaching its alert — ${watching[0].text}.` : 'No major credit risks building right now.'

  const goods = cats.filter(c => c.tone === 'good')
  const pool = goods.length ? goods : [...cats].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
  const best = pool.sort((a, b) => STAB_PREF.indexOf(a.key) - STAB_PREF.indexOf(b.key))[0]
  const stabilizer = best ? (STAB_PHRASE[`${best.key}:${best.status}`] ?? `${best.label} is holding steady.`) : 'No clear stabilizers right now.'
  return { risk, stabilizer }
}

function buildLastAlert(d: CreditData): string | null {
  // Most recent time the HY spread crossed the 5% stress line.
  for (const o of d.hy.obs) {
    if (o.value >= 5) return `High-yield spread last above 5% on ${new Date(o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`
  }
  // Otherwise the HY peak in the window — a real, dated stress reference.
  if (d.hy.obs.length) {
    let peak = d.hy.obs[0]
    for (const o of d.hy.obs) if (o.value > peak.value) peak = o
    return `Credit markets calm — the high-yield spread peaked at ${fPct(peak.value)} in ${new Date(peak.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} and has eased since.`
  }
  return null
}

// ── Public entry point ────────────────────────────────────────────────
export type CreditModel = {
  available: boolean
  status: CreditStatus
  subtitle: string
  risk: string
  stabilizer: string
  categories: Category[]
  alerts: CreditAlert[]
  lastAlert: string | null
  watching: WatchItem[]
}

const SUBTITLES: Record<string, string> = {
  'Healthy Lending': 'Credit is flowing freely and lenders remain confident.',
  'Selective Lending': 'Credit is still available, but lenders are growing more selective.',
  'Tightening Conditions': 'Lenders are pulling back and credit stress is building.',
  'Credit Stress': 'Credit stress is emerging — lenders are repricing risk.',
  'Credit Crunch': 'Credit is contracting sharply across the system.',
  'Data Unavailable': 'Live credit-market data is temporarily unavailable.',
}

export async function buildCreditModel(): Promise<CreditModel> {
  const data = await fetchCreditData()

  // HY spread is the keystone — if it's missing, don't fabricate a status.
  if (data.hy.latest == null) {
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      risk: '', stabilizer: '', categories: [], alerts: [], lastAlert: null, watching: [],
    }
  }

  const categories = [scoreLending(data), scoreCorporate(data), scoreConsumer(data), scoreFinancial(data)].map(withFill)
  const status = overallStatus(categories)
  const alerts = buildAlerts(data)
  const watching = buildWatching(data, alerts)
  const { risk, stabilizer } = riskAndStabilizer(categories, watching)

  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    risk, stabilizer, categories, alerts,
    lastAlert: buildLastAlert(data),
    watching,
  }
}
