// lib/bonds.ts
// Bond-market intelligence model. Translates Treasury signals into a single
// narrative answering "what are bond investors telling us about the economy?".
// Four themes — Growth Expectations, Interest Rate Environment, Government
// Financing, Market Stress — each scored on real FRED data; the overall Bond
// Status is the strongest signal among them.
//
// This page deliberately does NOT own inflation or credit narratives — only how
// bond investors are REACTING to conditions (rates higher-for-longer, growth
// slowing, fiscal stress, risk repricing).
//
// Metric notes (no free real-time public source):
//   Treasury volatility (MOVE) -> realized vol of the 10Y yield (daily history)
//   Auction bid-to-cover/demand -> not available; omitted from scoring
//   Term premium / liquidity    -> approximated via realized vol + curve moves

import { fredFetch } from './fred'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'
const FRED_KEY = process.env.FRED_API_KEY

export type Obs = { date: string; value: number }

async function fredSeries(seriesId: string, limit: number, units = 'lin'): Promise<Obs[]> {
  try {
    const url = `${FRED_BASE}?series_id=${seriesId}&units=${units}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${limit}`
    const res = await fredFetch(url, { next: { revalidate: 3600 } }) // cache 1h
    if (!res || !res.ok) return []
    const data = await res.json()
    return (data.observations || [])
      .filter((o: { value: string }) => o.value !== '.' && o.value !== '')
      .map((o: { date: string; value: string }) => ({ date: o.date, value: parseFloat(o.value) }))
  } catch { return [] }
}

// obs are newest-first. Value at (or just before) N days back from latest.
function valueDaysBack(obs: Obs[], days: number): number | null {
  if (!obs.length) return null
  const target = new Date(obs[0].date)
  target.setDate(target.getDate() - days)
  for (const o of obs) if (new Date(o.date) <= target) return o.value
  return null
}

// Raw change vs ~N days ago (same unit as series)
function chgDaysBack(obs: Obs[], days: number): number | null {
  const latest = obs[0]?.value ?? null
  const past = valueDaysBack(obs, days)
  if (latest == null || past == null) return null
  return parseFloat((latest - past).toFixed(2))
}

// Realized volatility of a daily yield series: stdev of daily changes (in bp)
// over the last `n` observations. Calm ~5bp, stressed >12bp.
function realizedVolBp(obs: Obs[], n = 21): number | null {
  if (obs.length < n + 1) return null
  const diffs: number[] = []
  for (let i = 0; i < n; i++) diffs.push((obs[i].value - obs[i + 1].value) * 100) // pp → bp
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
  const variance = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length
  return parseFloat(Math.sqrt(variance).toFixed(1))
}

// Downsample newest-first obs → oldest→newest series (~max points) for the
// interactive driver-card sparkline + expand chart.
function spark(obs: Obs[], max = 48): { date: string; value: number }[] | undefined {
  if (!obs || obs.length < 2) return undefined
  const asc = [...obs].reverse()
  if (asc.length <= max) return asc.map(o => ({ date: o.date, value: o.value }))
  const step = Math.ceil(asc.length / max)
  return asc.filter((_, i) => i % step === 0 || i === asc.length - 1).map(o => ({ date: o.date, value: o.value }))
}

export type MetricCard = { label: string; value: string; sub?: string; unit?: string; points?: { date: string; value: number }[] }
const fPct = (v: number | null, d = 2) => v == null ? '—' : `${v.toFixed(d)}%`
const fSpread = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

export type BondData = {
  tenY: number | null
  thirtY: number | null
  twoY: number | null
  threeMo: number | null
  realYield: number | null       // 10Y TIPS
  fedFunds: number | null
  spread2_10: number | null      // 10Y − 2Y
  spread3m_10: number | null     // 10Y − 3M
  tenYChg3m: number | null       // 10Y change vs ~3 months ago (pp)
  thirtYChg3m: number | null
  volBp: number | null           // realized 10Y vol (bp)
  debtToGDP: number | null
  thirtYMax: number | null       // max 30Y over the long window (multi-decade high)
  spread3m10History: Obs[]       // for uninversion detection + sparkline
  tenYHistory: Obs[]             // for the 5% alert lookback + sparkline
  twoYObs: Obs[]
  thirtYObs: Obs[]
  realYieldObs: Obs[]
  fedFundsObs: Obs[]
  spread2_10Obs: Obs[]
  debtObs: Obs[]
}

export async function fetchBondData(): Promise<BondData> {
  const [dgs10, dgs30, dgs2, dgs3mo, dfii10, ff, t10y2y, t10y3m, debt] = await Promise.all([
    fredSeries('DGS10', 520),     // ~2y daily — vol, trend, alert lookback, sparkline
    fredSeries('DGS30', 9000),    // long window for the multi-decade-high check
    fredSeries('DGS2', 260),
    fredSeries('DGS3MO', 5),
    fredSeries('DFII10', 260),    // 10Y real yield (TIPS)
    fredSeries('FEDFUNDS', 60),
    fredSeries('T10Y2Y', 260),
    fredSeries('T10Y3M', 400),    // spread + history for uninversion
    fredSeries('GFDEGDQ188S', 44), // public debt as % of GDP (quarterly)
  ])

  return {
    tenY: dgs10[0]?.value ?? null,
    thirtY: dgs30[0]?.value ?? null,
    twoY: dgs2[0]?.value ?? null,
    threeMo: dgs3mo[0]?.value ?? null,
    realYield: dfii10[0]?.value ?? null,
    fedFunds: ff[0]?.value ?? null,
    spread2_10: t10y2y[0]?.value ?? null,
    spread3m_10: t10y3m[0]?.value ?? null,
    tenYChg3m: chgDaysBack(dgs10, 91),
    thirtYChg3m: chgDaysBack(dgs30, 91),
    volBp: realizedVolBp(dgs10),
    debtToGDP: debt[0]?.value ?? null,
    thirtYMax: dgs30.length ? Math.max(...dgs30.map(o => o.value)) : null,
    spread3m10History: t10y3m,
    tenYHistory: dgs10,
    twoYObs: dgs2,
    thirtYObs: dgs30,
    realYieldObs: dfii10,
    fedFundsObs: ff,
    spread2_10Obs: t10y2y,
    debtObs: debt,
  }
}

// ── Category scoring ──────────────────────────────────────────────────
export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
export type Category = {
  key: string
  label: string
  status: string
  tone: Tone
  fill: number            // 0..1 (1 = healthiest / calmest)
  signals: string[]
  metrics: MetricCard[]
}
const TONE_FILL: Record<Tone, number> = { good: 0.9, neutral: 0.55, warn: 0.4, bad: 0.18, crisis: 0.08 }
function withFill(c: Omit<Category, 'fill'>): Category {
  return { ...c, fill: TONE_FILL[c.tone] }
}

// 1 ── Growth Expectations (yield-curve recession signal) ──────────────
function scoreGrowth(d: BondData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const s310 = d.spread3m_10, s210 = d.spread2_10
  if (s310 != null) signals.push(`3M–10Y spread ${fSpread(s310)} — ${s310 < 0 ? 'inverted (the most reliable recession signal)' : 'positive'}`)
  if (s210 != null) signals.push(`2Y–10Y spread ${fSpread(s210)} — ${s210 < 0 ? 'inverted' : 'normal'}`)
  if (d.twoY != null && d.fedFunds != null) {
    const gap = parseFloat((d.twoY - d.fedFunds).toFixed(2))
    if (gap <= -0.5) signals.push(`2Y yield ${Math.abs(gap)}pp below fed funds — markets pricing rate cuts ahead`)
    else if (gap >= 0.3) signals.push(`2Y yield above fed funds — markets pricing few cuts`)
  }
  if (d.tenYChg3m != null) signals.push(`10Y yield ${d.tenYChg3m >= 0 ? 'up' : 'down'} ${Math.abs(d.tenYChg3m)}pp over 3 months`)

  const deepInv = (s310 != null && s310 <= -1.0) || (s210 != null && s210 <= -1.0)
  const inverted = (s310 != null && s310 < 0) || (s210 != null && s210 < 0)
  const steep = s310 != null && s310 >= 0.6

  let status: string, tone: Tone
  if (deepInv) { status = 'Recession Risk Rising'; tone = 'bad' }
  else if (inverted) { status = 'Growth Slowing'; tone = 'warn' }
  else if (steep) { status = 'Normal Expansion'; tone = 'good' }
  else { status = 'Stable Growth'; tone = 'neutral' }

  const metrics: MetricCard[] = [
    { label: '2Y–10Y Spread', value: fSpread(s210), unit: '%', points: spark(d.spread2_10Obs), sub: s210 != null && s210 < 0 ? 'inverted' : 'normal' },
    { label: '3M–10Y Spread', value: fSpread(s310), unit: '%', points: spark(d.spread3m10History), sub: s310 != null && s310 < 0 ? 'inverted' : 'normal' },
    { label: '10Y Yield', value: fPct(d.tenY), unit: '%', points: spark(d.tenYHistory), sub: d.tenYChg3m != null ? `${d.tenYChg3m >= 0 ? '+' : ''}${d.tenYChg3m}pp 3mo` : undefined },
    { label: '2Y Yield', value: fPct(d.twoY), unit: '%', points: spark(d.twoYObs) },
  ]
  return { key: 'growth', label: 'Growth Expectations', status, tone, signals, metrics }
}

// 2 ── Interest Rate Environment (how restrictive financing is) ────────
function scoreRates(d: BondData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const ry = d.realYield, ten = d.tenY
  if (ten != null) signals.push(`10Y Treasury at ${fPct(ten)}`)
  if (d.thirtY != null) signals.push(`30Y Treasury at ${fPct(d.thirtY)}`)
  if (ry != null) signals.push(`10Y real yield ${fPct(ry)} — ${ry >= 1.5 ? 'firmly positive and restrictive' : ry >= 0.5 ? 'positive' : 'low'}`)
  if (d.fedFunds != null) signals.push(`Fed funds at ${fPct(d.fedFunds)}`)

  let status: string, tone: Tone
  if ((ry != null && ry >= 2.5) || (ten != null && ten >= 5.0)) { status = 'Restrictive Financing'; tone = 'bad' }
  else if (ten != null && ten >= 4.0 && (ry == null || ry >= 1.0)) { status = 'Rates Higher For Longer'; tone = 'warn' }
  else if (ten != null && ten < 3.0 && (ry == null || ry < 0.5)) { status = 'Accommodative Financing'; tone = 'good' }
  else { status = 'Neutral'; tone = 'neutral' }

  const metrics: MetricCard[] = [
    { label: '10Y Treasury', value: fPct(ten), unit: '%', points: spark(d.tenYHistory) },
    { label: '30Y Treasury', value: fPct(d.thirtY), unit: '%', points: spark(d.thirtYObs) },
    { label: '10Y Real Yield', value: fPct(ry), unit: '%', points: spark(d.realYieldObs), sub: 'TIPS' },
    { label: 'Fed Funds', value: fPct(d.fedFunds), unit: '%', points: spark(d.fedFundsObs) },
  ]
  return { key: 'rates', label: 'Interest Rate Environment', status, tone, signals, metrics }
}

// 3 ── Government Financing (fiscal / Treasury financing stress) ───────
function scoreFinancing(d: BondData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const t30 = d.thirtY
  const nearMultiDecadeHigh = t30 != null && d.thirtYMax != null && t30 >= d.thirtYMax - 0.1
  if (t30 != null) signals.push(`30Y Treasury at ${fPct(t30)}${nearMultiDecadeHigh ? ' — near a multi-decade high' : ''}`)
  if (d.thirtYChg3m != null) signals.push(`30Y yield ${d.thirtYChg3m >= 0 ? 'up' : 'down'} ${Math.abs(d.thirtYChg3m)}pp over 3 months${d.thirtYChg3m >= 0.4 ? ' — financing costs rising fast' : ''}`)
  if (d.debtToGDP != null) signals.push(`Federal debt at ${d.debtToGDP.toFixed(0)}% of GDP`)

  const risingFast = d.thirtYChg3m != null && d.thirtYChg3m >= 0.4

  let status: string, tone: Tone
  if (nearMultiDecadeHigh && risingFast) { status = 'Financing Warning'; tone = 'crisis' }
  else if (t30 != null && t30 >= 6) { status = 'Fiscal Stress'; tone = 'bad' }
  else if (t30 != null && (t30 >= 5 || nearMultiDecadeHigh)) { status = 'Rising Fiscal Pressure'; tone = 'warn' }
  else if (t30 != null && t30 >= 4) { status = 'Manageable'; tone = 'neutral' }
  else { status = 'Stable Financing'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: '30Y Treasury', value: fPct(t30), unit: '%', points: spark(d.thirtYObs), sub: d.thirtYChg3m != null ? `${d.thirtYChg3m >= 0 ? '+' : ''}${d.thirtYChg3m}pp 3mo` : undefined },
    { label: 'Debt-to-GDP', value: d.debtToGDP != null ? `${d.debtToGDP.toFixed(0)}%` : '—', unit: '%', points: spark(d.debtObs) },
    { label: '30Y Record High', value: fPct(d.thirtYMax), sub: nearMultiDecadeHigh ? 'at/near it now' : 'in 30+ yr record' },
  ]
  return { key: 'financing', label: 'Government Financing', status, tone, signals, metrics }
}

// 4 ── Market Stress (are investors turning defensive?) ────────────────
function scoreMarketStress(d: BondData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const vol = d.volBp
  if (vol != null) signals.push(`10Y yield volatility ${vol}bp/day — ${vol >= 12 ? 'stressed' : vol >= 8 ? 'elevated' : 'calm'} (calm ≈ 5bp)`)
  // A sharp 10Y drop alongside high vol is the flight-to-safety tell
  const drop = d.tenYHistory.length > 5 ? (d.tenYHistory[0].value - d.tenYHistory[5].value) * 100 : null
  if (drop != null && drop <= -15) signals.push(`10Y fell ${Math.abs(Math.round(drop))}bp in a week — flight-to-safety bid`)

  let status: string, tone: Tone
  if (vol != null && vol >= 13) { status = drop != null && drop <= -15 ? 'Flight to Safety' : 'Risk Repricing'; tone = 'bad' }
  else if (vol != null && vol >= 8) { status = 'Risk Repricing'; tone = 'warn' }
  else if (vol != null && vol >= 6) { status = 'Stable'; tone = 'neutral' }
  else { status = 'Calm Markets'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: '10Y Yield Volatility', value: vol != null ? `${vol} bp/day` : '—', sub: 'realized, 1mo' },
    { label: '10Y Weekly Move', value: drop != null ? `${drop >= 0 ? '+' : ''}${Math.round(drop)} bp` : '—' },
  ]
  return { key: 'stress', label: 'Market Stress', status, tone, signals, metrics }
}

// ── Overall status engine — the strongest signal ──────────────────────
export type BondStatus = { emoji: string; label: string; tone: Tone }
const TONE_RANK: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3, crisis: 4 }
const TONE_EMOJI: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }
// Tie-break when several themes share the worst tone — most acute first.
// Flight-to-safety and recession signals lead; among the everyday (warn) signals
// the rate-environment narrative leads the fiscal one.
const SIGNAL_PRIORITY = ['stress', 'growth', 'rates', 'financing']

function overallStatus(cats: Category[]): BondStatus {
  const worst = [...cats].sort((a, b) => {
    const r = TONE_RANK[b.tone] - TONE_RANK[a.tone]
    return r !== 0 ? r : SIGNAL_PRIORITY.indexOf(a.key) - SIGNAL_PRIORITY.indexOf(b.key)
  })[0]
  if (!worst || worst.tone === 'good' || worst.tone === 'neutral') {
    return { emoji: '🟢', label: 'Calm Markets', tone: 'good' }
  }
  return { emoji: TONE_EMOJI[worst.tone], label: worst.status, tone: worst.tone }
}

// ── Alerts ────────────────────────────────────────────────────────────
export type BondAlert = {
  id: string
  title: string
  what: string
  why: string
  affected: string[]
  context: string
}

// Months since the 10Y was last at/above `level` (excluding today)
function monthsSince10yAbove(history: Obs[], level: number): number | null {
  if (history.length < 2) return null
  const latest = new Date(history[0].date)
  for (let i = 1; i < history.length; i++) {
    if (history[i].value >= level) {
      const d = new Date(history[i].date)
      return Math.round((latest.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.4))
    }
  }
  return null
}

function buildAlerts(d: BondData): BondAlert[] {
  const alerts: BondAlert[] = []

  if (d.tenY != null && d.tenY >= 5) {
    const m = monthsSince10yAbove(d.tenYHistory.slice(1), 5)
    alerts.push({
      id: 'tenY-5', title: '10-Year Treasury Above 5%',
      what: `The 10-year yield is at ${fPct(d.tenY)}.`,
      why: 'The 10-year sets the floor for mortgages, corporate borrowing, and equity valuations. Above 5% financing turns broadly restrictive.',
      affected: ['Housing', 'Business Investment', 'Stock Market', 'Consumer Borrowing'],
      context: m != null ? `First break above 5% in ${m} months.` : 'A level rarely seen since before the 2008 crisis.',
    })
  }

  if (d.thirtY != null && d.thirtY >= 6) {
    alerts.push({
      id: 'thirtY-6', title: '30-Year Treasury Above 6%',
      what: `The 30-year yield is at ${fPct(d.thirtY)}.`,
      why: 'Long-bond yields this high sharply raise the government\'s interest bill and signal investors demanding more to fund long-term debt.',
      affected: ['Government Finance', 'Housing', 'Business Investment'],
      context: 'Among the highest long-bond yields in decades.',
    })
  } else if (d.thirtY != null && d.thirtYMax != null && d.thirtY >= d.thirtYMax - 0.1) {
    alerts.push({
      id: 'thirtY-high', title: '30-Year Treasury at a Multi-Decade High',
      what: `The 30-year yield is at ${fPct(d.thirtY)}, at the top of its 30+ year range.`,
      why: 'Rising long-term financing costs increase the federal interest burden and tighten conditions for long-dated borrowing.',
      affected: ['Government Finance', 'Housing', 'Business Investment'],
      context: 'Long-end yields are testing levels not sustained in over a decade.',
    })
  }

  const s310 = d.spread3m_10
  if (s310 != null && s310 <= -1.0) {
    alerts.push({
      id: 'deep-inversion', title: 'Yield Curve in Deep Inversion',
      what: `The 3M–10Y spread is ${fSpread(s310)}.`,
      why: 'A deeply inverted curve means investors expect sharply lower rates ahead — historically a strong recession lead indicator.',
      affected: ['Business Investment', 'Stock Market', 'Bank Lending'],
      context: 'The 3M–10Y inversion has preceded every US recession in the past 50 years.',
    })
  }

  // Uninversion after a prolonged inversion (good news)
  const h = d.spread3m10History
  if (s310 != null && s310 >= 0 && h.length > 60) {
    const recentlyInverted = h.slice(1, 60).some(o => o.value < -0.1)
    if (recentlyInverted) {
      alerts.push({
        id: 'uninversion', title: 'Yield Curve Has Un-Inverted',
        what: `The 3M–10Y spread is back to ${fSpread(s310)} after a prolonged inversion.`,
        why: 'A return to a positive curve eases pressure on bank lending margins — though historically recessions often begin shortly AFTER the curve normalizes.',
        affected: ['Bank Lending', 'Business Investment'],
        context: 'Normalization is a milestone, but the post-inversion window has historically carried elevated recession risk.',
      })
    }
  }

  if (d.volBp != null && d.volBp >= 13) {
    alerts.push({
      id: 'vol-stress', title: 'Treasury Volatility at Stress Levels',
      what: `Realized 10-year volatility is ${d.volBp}bp/day (calm is roughly 5bp).`,
      why: 'Spiking Treasury volatility signals disorderly repricing and reduced liquidity in the world\'s benchmark safe asset.',
      affected: ['Stock Market', 'Credit Markets', 'Bank Lending'],
      context: 'Used as a MOVE-index proxy (no free real-time source for MOVE).',
    })
  }

  return alerts
}

// ── Watching closely (never empty) ────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number }

function buildWatching(d: BondData, alerts: BondAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []

  if (d.tenY != null && !firing.has('tenY-5')) {
    const dist = parseFloat((5 - d.tenY).toFixed(2))
    items.push({ label: '10-Year Treasury', text: `${dist}pp below the 5% alert`, proximity: Math.max(0, Math.min(1, d.tenY / 5)) })
  }
  if (d.thirtY != null && !firing.has('thirtY-6')) {
    const dist = parseFloat((6 - d.thirtY).toFixed(2))
    items.push({ label: '30-Year Treasury', text: `${dist}pp below the 6% alert`, proximity: Math.max(0, Math.min(1, d.thirtY / 6)) })
  }
  if (d.volBp != null && !firing.has('vol-stress')) {
    const dist = parseFloat((13 - d.volBp).toFixed(1))
    items.push({ label: 'Treasury Volatility', text: `${dist}bp below the stress threshold (13bp)`, proximity: Math.max(0, Math.min(1, d.volBp / 13)) })
  }
  if (d.spread3m_10 != null && !firing.has('deep-inversion')) {
    const s = d.spread3m_10
    if (s < 0) items.push({ label: 'Yield Curve', text: `${parseFloat((s + 1).toFixed(2))}pp above the deep-inversion alert (−1.0%)`, proximity: Math.max(0, Math.min(1, Math.abs(s) / 1.0)) })
    else items.push({ label: 'Yield Curve', text: `${fSpread(s)} — positive; watching for re-inversion`, proximity: Math.max(0, Math.min(1, 0.3 - Math.min(0.3, s) / 1)) })
  }

  return items.sort((a, b) => b.proximity - a.proximity)
}

// ── Biggest risk / biggest stabilizer ─────────────────────────────────
const RISK_PHRASE: Record<string, string> = {
  'growth:Recession Risk Rising': 'A deeply inverted curve signals bond investors are bracing for recession.',
  'growth:Growth Slowing': 'The yield curve is signalling a cooling economy ahead.',
  'rates:Restrictive Financing': 'Restrictive yields and high real rates are squeezing borrowers.',
  'rates:Rates Higher For Longer': 'Bond investors expect restrictive borrowing costs to persist.',
  'financing:Fiscal Stress': 'Surging long-bond yields are straining government financing.',
  'financing:Rising Fiscal Pressure': 'Rising long-term yields are lifting the cost of funding federal debt.',
  'financing:Financing Warning': 'Long-bond yields are spiking toward a financing warning.',
  'stress:Flight to Safety': 'Investors are rushing into Treasuries — a defensive, risk-off signal.',
  'stress:Risk Repricing': 'Treasury volatility is rising as markets reprice risk.',
}
const STABILIZER_PHRASE: Record<string, string> = {
  'stress:Calm Markets': 'Treasury markets are calm and orderly.',
  'stress:Stable': 'Treasury volatility remains contained.',
  'rates:Accommodative Financing': 'Borrowing costs remain accommodative.',
  'rates:Neutral': 'Rates sit in neutral territory.',
  'financing:Stable Financing': 'Government financing conditions remain stable.',
  'financing:Manageable': 'Treasury financing costs remain manageable.',
  'growth:Normal Expansion': 'The curve points to normal economic expansion.',
  'growth:Stable Growth': 'Growth expectations remain steady.',
}
const STABILIZER_PREF = ['stress', 'financing', 'rates', 'growth']

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: string; stabilizer: string } {
  const worst = [...cats].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone])[0]
  const risk = worst && TONE_RANK[worst.tone] >= 2
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label}: ${worst.status}.`)
    : watching[0]
      ? `${watching[0].label} approaching its alert — ${watching[0].text}.`
      : 'No major bond-market risks building right now.'

  const goods = cats.filter(c => c.tone === 'good')
  const pool = goods.length ? goods : [...cats].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
  const best = pool.sort((a, b) => STABILIZER_PREF.indexOf(a.key) - STABILIZER_PREF.indexOf(b.key))[0]
  const stabilizer = best
    ? (STABILIZER_PHRASE[`${best.key}:${best.status}`] ?? `${best.label} is holding steady.`)
    : 'No clear stabilizers right now.'
  return { risk, stabilizer }
}

// Most recent bond event for "Last alert" when none are active.
function buildLastAlert(d: BondData): string | null {
  // When did the 10Y last cross 5%?
  for (const o of d.tenYHistory) {
    if (o.value >= 5) {
      const when = new Date(o.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      return `10-Year Treasury last above 5% on ${when}.`
    }
  }
  // Otherwise note the most recent curve inversion in the window
  for (const o of d.spread3m10History) {
    if (o.value < 0) {
      const when = new Date(o.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      return `Yield curve (3M–10Y) last inverted ${when}.`
    }
  }
  return null
}

// ── Public entry point ────────────────────────────────────────────────
export type BondModel = {
  available: boolean
  status: BondStatus
  subtitle: string
  risk: string
  stabilizer: string
  categories: Category[]
  alerts: BondAlert[]
  lastAlert: string | null
  watching: WatchItem[]
  data: BondData
}

const SUBTITLES: Record<string, string> = {
  'Normal Expansion': 'The curve and yields point to steady economic growth.',
  'Stable Growth': 'Bond investors see growth holding steady, with no recession signal.',
  'Growth Slowing': 'The yield curve is signalling a softening economy ahead.',
  'Recession Risk Rising': 'A deeply inverted curve is flashing recession risk.',
  'Accommodative Financing': 'Borrowing costs are easy by recent standards.',
  'Neutral': 'Financing conditions are neither tight nor loose.',
  'Rates Higher For Longer': 'Bond investors expect restrictive borrowing costs to persist.',
  'Restrictive Financing': 'Yields and real rates are squeezing borrowers.',
  'Stable Financing': 'Government financing conditions are stable.',
  'Manageable': 'Treasury financing costs remain manageable.',
  'Rising Fiscal Pressure': 'Rising long-term yields are lifting federal funding costs.',
  'Fiscal Stress': 'Surging long-bond yields are straining government financing.',
  'Financing Warning': 'Long-bond yields are spiking toward a financing warning.',
  'Calm Markets': 'Treasury markets are calm and orderly.',
  'Stable': 'Treasury volatility is contained.',
  'Risk Repricing': 'Treasury volatility is rising as markets reprice risk.',
  'Flight to Safety': 'Investors are rushing into Treasuries — a risk-off signal.',
  'Data Unavailable': 'Live bond-market data is temporarily unavailable.',
}

export async function buildBondModel(): Promise<BondModel> {
  const data = await fetchBondData()

  // Data-unavailable guard — the 10Y is the keystone series.
  if (data.tenY == null) {
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      risk: '', stabilizer: '',
      categories: [], alerts: [], lastAlert: null, watching: [], data,
    }
  }

  const categories = [
    scoreGrowth(data),
    scoreRates(data),
    scoreFinancing(data),
    scoreMarketStress(data),
  ].map(withFill)
  const status = overallStatus(categories)
  const alerts = buildAlerts(data)
  const watching = buildWatching(data, alerts)
  const { risk, stabilizer } = riskAndStabilizer(categories, watching)

  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    risk, stabilizer,
    categories, alerts,
    lastAlert: buildLastAlert(data),
    watching, data,
  }
}
