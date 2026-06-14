// lib/inflation.ts
// Inflation intelligence model. Answers one question: "is inflation getting
// better or worse?". Four themes — Current Inflation, Inflation Trend, Energy
// Pressure, Consumer Cost Pressure — each scored on real FRED data; the overall
// Inflation Status reflects the DOMINANT TREND, not a single month's reading.
//
// Metric notes:
//   CPI / Core CPI       -> CPIAUCSL / CPILFESL index → YoY + 3-month annualized
//   Shelter / Food       -> CUSR0000SAH1 / CPIUFDSL index → YoY
//   Energy               -> WTI (DCOILWTICO) + retail gasoline (GASREGW)

import { fredFetch } from './fred'
import { toneHigh } from './metricTone'

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

// Year-over-year inflation rate from a (desc-sorted) monthly price INDEX series.
// Returns a desc series of {date, value=YoY%} so it can drive a sparkline.
function yoySeries(idx: Obs[]): Obs[] {
  const out: Obs[] = []
  for (let i = 0; i + 12 < idx.length; i++) {
    out.push({ date: idx[i].date, value: parseFloat(((idx[i].value / idx[i + 12].value - 1) * 100).toFixed(2)) })
  }
  return out
}
// 3-month annualized rate from a monthly price index: ((idx0/idx3)^4 - 1)*100.
function annualized3m(idx: Obs[]): number | null {
  if (idx.length < 4 || idx[3].value === 0) return null
  return parseFloat(((Math.pow(idx[0].value / idx[3].value, 4) - 1) * 100).toFixed(1))
}

// ── shared card helpers (mirror the other intelligence tabs) ──────────
export type MetricCard = {
  label: string; value: string; sub?: string; unit?: string
  tone?: Tone
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

const fPct = (v: number | null, d = 1) => v == null ? '—' : `${v.toFixed(d)}%`
const fUsd = (v: number | null, d = 0) => v == null ? '—' : `$${v.toFixed(d)}`

export type InflationData = {
  cpiIdx: Obs[]; coreIdx: Obs[]; shelterIdx: Obs[]; foodIdx: Obs[]
  cpiYoY: Obs[]; coreYoY: Obs[]; shelterYoY: Obs[]; foodYoY: Obs[]
  wti: Obs[]; gas: Obs[]
}

export async function fetchInflationData(): Promise<InflationData> {
  const [cpi, core, shelter, food, wti, gas] = await Promise.all([
    fredSeries('CPIAUCSL', 170),    // monthly index, ~14y
    fredSeries('CPILFESL', 170),    // core (ex food & energy)
    fredSeries('CUSR0000SAH1', 170),// shelter
    fredSeries('CPIUFDSL', 170),    // food
    fredSeries('DCOILWTICO', 1300), // WTI crude, daily ~5y
    fredSeries('GASREGW', 620),     // retail gasoline, weekly ~12y
  ])
  return {
    cpiIdx: cpi, coreIdx: core, shelterIdx: shelter, foodIdx: food,
    cpiYoY: yoySeries(cpi), coreYoY: yoySeries(core), shelterYoY: yoySeries(shelter), foodYoY: yoySeries(food),
    wti, gas,
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

// 1 ── Current Inflation (what is inflation right now?) ─────────────────
function scoreCurrent(d: InflationData): Omit<Category, 'fill'> {
  const head = d.cpiYoY[0]?.value ?? null
  const core = d.coreYoY[0]?.value ?? null
  const signals: string[] = []
  if (head != null) signals.push(`Headline CPI running at ${fPct(head)} year-over-year`)
  if (core != null) signals.push(`Core CPI (ex food & energy) at ${fPct(core)} YoY — the stickier underlying trend`)
  if (head != null) signals.push(head <= 2.6 ? 'Within striking distance of the Fed’s 2% target' : `Still ${(head - 2).toFixed(1)}pp above the 2% target`)

  const ref = Math.max(core ?? -99, head ?? -99)
  let status: string, tone: Tone
  if (ref >= 8) { status = 'High Inflation'; tone = 'crisis' }
  else if ((head != null && head >= 5) || (core != null && core >= 4.5)) { status = 'High Inflation'; tone = 'bad' }
  else if ((core != null && core >= 3.6) || (head != null && head >= 4)) { status = 'Persistent'; tone = 'warn' }
  else if ((core != null && core >= 3.0) || (head != null && head >= 3.0)) { status = 'Elevated'; tone = 'neutral' }
  else { status = 'Near Target'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'CPI (YoY)', value: fPct(head), unit: '%', tone: toneHigh(head, 3, 4, 6), points: spark(d.cpiYoY), ...hist(d.cpiYoY), ...alertAbove(head, 4) },
    { label: 'Core CPI (YoY)', value: fPct(core), unit: '%', sub: 'ex food & energy', tone: toneHigh(core, 3, 4, 5.5), points: spark(d.coreYoY), ...hist(d.coreYoY), ...alertAbove(core, 4) },
  ]
  return { key: 'current', label: 'Current Inflation', status, tone, signals, metrics }
}

// 2 ── Inflation Trend (is inflation improving or worsening?) ───────────
// Direction carries more weight than level: the 3-month annualized pace shows
// where inflation is heading before it shows up in the year-over-year number.
function scoreTrend(d: InflationData): Omit<Category, 'fill'> {
  const c3 = annualized3m(d.coreIdx)
  const h3 = annualized3m(d.cpiIdx)
  const coreYoY = d.coreYoY[0]?.value ?? null
  const momentum = c3 != null && coreYoY != null ? parseFloat((c3 - coreYoY).toFixed(1)) : null // >0 = reaccelerating
  const signals: string[] = []
  if (h3 != null) signals.push(`Headline CPI running at a ${fPct(h3)} annualized pace over the last 3 months`)
  if (c3 != null) signals.push(`Core CPI 3-month annualized pace at ${fPct(c3)}`)
  if (momentum != null) signals.push(momentum >= 0.4 ? `Recent pace is running ${momentum.toFixed(1)}pp HOTTER than the yearly rate — momentum is building` : momentum <= -0.4 ? `Recent pace is running ${Math.abs(momentum).toFixed(1)}pp cooler than the yearly rate — disinflation continuing` : 'Recent pace roughly matches the yearly rate — little momentum either way')

  let status: string, tone: Tone
  if (momentum != null && momentum >= 0.8 && c3 != null && c3 >= 3) { status = 'Reaccelerating'; tone = 'bad' }
  else if ((c3 != null && c3 <= 2.6) || (momentum != null && momentum <= -0.8)) { status = 'Improving'; tone = 'good' }
  else if (c3 != null && c3 >= 3.2) { status = 'Stalled'; tone = 'warn' }
  else { status = 'Stable'; tone = 'neutral' }

  // No sparkline on the 3-month cards: their value is the annualized PACE, which
  // would clash with a year-over-year history line and read as misleading.
  const metrics: MetricCard[] = [
    { label: 'Core CPI 3mo Annualized', value: fPct(c3), unit: '%', sub: 'where it’s heading', tone: toneHigh(c3, 3, 4) },
    { label: 'CPI 3mo Annualized', value: fPct(h3), unit: '%', sub: 'recent 3-month pace', tone: toneHigh(h3, 4, 6) },
    { label: 'Inflation Momentum', value: momentum == null ? '—' : `${momentum >= 0 ? '+' : ''}${momentum.toFixed(1)}pp`, sub: '3mo pace vs yearly', tone: toneHigh(momentum, 0.4, 1) },
  ]
  return { key: 'trend', label: 'Inflation Trend', status, tone, signals, metrics }
}

// 3 ── Energy Pressure (could energy reignite inflation?) ───────────────
function scoreEnergy(d: InflationData): Omit<Category, 'fill'> {
  const wti = d.wti[0]?.value ?? null
  const wti3 = pctChange(wti, valueDaysBack(d.wti, 91))
  const gas = d.gas[0]?.value ?? null
  const signals: string[] = []
  if (wti != null) signals.push(`WTI crude at ${fUsd(wti)}${wti3 != null ? ` (${wti3 >= 0 ? '+' : ''}${wti3}% over 3 months)` : ''}`)
  if (gas != null) signals.push(`Retail gasoline averaging ${fUsd(gas, 2)}/gallon`)
  signals.push(wti != null && wti >= 88 ? 'Elevated energy costs feed through to headline inflation within weeks' : 'Stable energy prices are keeping a lid on headline inflation')

  let status: string, tone: Tone
  if (wti != null && wti >= 110) { status = 'Energy Shock Risk'; tone = 'bad' }
  else if ((wti != null && wti >= 88) || (wti3 != null && wti3 >= 18)) { status = 'Rising Pressure'; tone = 'warn' }
  else if (wti != null && wti >= 65) { status = 'Normal'; tone = 'neutral' }
  else { status = 'Low Pressure'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'WTI Crude', value: fUsd(wti), unit: '', tone: toneHigh(wti, 88, 100, 120), points: spark(d.wti), ...hist(d.wti), ...alertAbove(wti, 100, '') },
    { label: 'Retail Gasoline', value: fUsd(gas, 2), unit: '', sub: 'per gallon', tone: toneHigh(gas, 3.75, 4.5), points: spark(d.gas), ...hist(d.gas) },
  ]
  return { key: 'energy', label: 'Energy Pressure', status, tone, signals, metrics }
}

// 4 ── Consumer Cost Pressure (why do things still feel expensive?) ─────
function scoreConsumer(d: InflationData): Omit<Category, 'fill'> {
  const shelter = d.shelterYoY[0]?.value ?? null
  const food = d.foodYoY[0]?.value ?? null
  const signals: string[] = []
  if (shelter != null) signals.push(`Shelter inflation at ${fPct(shelter)} YoY — the single largest contributor to core CPI`)
  if (food != null) signals.push(`Food inflation at ${fPct(food)} YoY`)
  signals.push(shelter != null && shelter >= 4 ? 'Sticky shelter costs are the main reason inflation still feels high' : 'Shelter costs are finally normalizing toward pre-pandemic norms')

  let status: string, tone: Tone
  if ((shelter != null && shelter >= 6) || (food != null && food >= 6)) { status = 'Affordability Pressure'; tone = 'bad' }
  else if (shelter != null && shelter >= 4.2) { status = 'Persistent'; tone = 'warn' }
  else if ((shelter != null && shelter >= 3.2) || (food != null && food >= 3.5)) { status = 'Elevated'; tone = 'neutral' }
  else { status = 'Normalizing'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'Shelter Inflation', value: fPct(shelter), unit: '%', sub: 'YoY', tone: toneHigh(shelter, 4, 5, 6), points: spark(d.shelterYoY), ...hist(d.shelterYoY), ...alertAbove(shelter, 5) },
    { label: 'Food Inflation', value: fPct(food), unit: '%', sub: 'YoY', tone: toneHigh(food, 4, 6), points: spark(d.foodYoY), ...hist(d.foodYoY) },
  ]
  return { key: 'consumer', label: 'Consumer Cost Pressure', status, tone, signals, metrics }
}

// ── Overall status — the dominant TREND ────────────────────────────────
export type InflationStatus = { emoji: string; label: string; tone: Tone }
const TONE_RANK: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3, crisis: 4 }
const TONE_EMOJI: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }
// Trend carries more weight than level → it wins ties.
const PRIORITY = ['trend', 'current', 'consumer', 'energy']

function overallStatus(cats: Category[]): InflationStatus {
  const by: Record<string, Category> = Object.fromEntries(cats.map(c => [c.key, c]))
  const worst = [...cats].sort((a, b) => {
    const r = TONE_RANK[b.tone] - TONE_RANK[a.tone]
    return r !== 0 ? r : PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)
  })[0]
  const tone = worst?.tone ?? 'good'
  const trend = by.trend, current = by.current
  const reaccel = trend?.status === 'Reaccelerating'
  const stalled = trend?.status === 'Stalled'
  const improving = trend?.status === 'Improving'

  let label: string
  if (tone === 'crisis') label = reaccel ? 'Renewed Inflation Surge' : 'Inflation Alert'
  else if (tone === 'bad') label = reaccel ? 'Inflation Reaccelerating' : 'Broad Price Pressure'
  else if (tone === 'warn') label = stalled ? 'Inflation Stalled' : worst?.key === 'consumer' ? 'Persistent Price Pressure' : 'Sticky Inflation'
  else if (tone === 'neutral') label = improving ? 'Elevated but Improving' : current?.tone === 'good' ? 'Inflation Moderating' : 'Mixed Signals'
  else label = current?.status === 'Near Target' ? 'Near Target' : 'Disinflation Progress'

  return { emoji: TONE_EMOJI[tone], label, tone }
}

// ── Alerts (separate from status) ──────────────────────────────────────
export type InflationAlert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }

// True when headline YoY rose for `n` consecutive monthly prints (latest first).
function acceleratingFor(yoy: Obs[], n: number): boolean {
  if (yoy.length < n + 1) return false
  for (let i = 0; i < n; i++) if (!(yoy[i].value > yoy[i + 1].value)) return false
  return true
}

function buildAlerts(d: InflationData, cats: Category[]): InflationAlert[] {
  const alerts: InflationAlert[] = []
  const head = d.cpiYoY[0]?.value ?? null
  const core = d.coreYoY[0]?.value ?? null
  const wti = d.wti[0]?.value ?? null
  const trend = cats.find(c => c.key === 'trend')

  if (head != null && head >= 8) {
    alerts.push({
      id: 'cpi-severe', title: 'Severe Inflation — CPI Above 8%',
      what: `Headline CPI is running at ${fPct(head)} year-over-year.`,
      why: 'Inflation this high is a four-decade extreme — it rapidly destroys purchasing power and forces the Fed into aggressive rate hikes that risk tipping the economy into recession.',
      affected: ['Consumer Spending', 'Federal Reserve Policy', 'Bonds', 'Credit', 'Housing'],
      context: 'CPI last exceeded 8% at the 2022 peak of 9.1% — the highest since 1981.',
    })
  } else if (head != null && head >= 5) {
    alerts.push({
      id: 'cpi-5', title: 'CPI Above 5%',
      what: `Headline CPI is running at ${fPct(head)} year-over-year.`,
      why: 'Inflation above 5% sharply erodes purchasing power and pressures the Fed to keep policy restrictive, raising borrowing costs across the economy.',
      affected: ['Consumer Spending', 'Federal Reserve Policy', 'Bonds', 'Credit'],
      context: 'Inflation last sustained above 5% during the 2021–2023 surge — the worst in four decades.',
    })
  } else if (head != null && head >= 4) {
    alerts.push({
      id: 'cpi-4', title: 'CPI Above 4%',
      what: `Headline CPI is at ${fPct(head)} year-over-year, double the Fed’s 2% target.`,
      why: 'Inflation stuck above 4% keeps real incomes under pressure and delays interest-rate relief for borrowers.',
      affected: ['Consumer Spending', 'Federal Reserve Policy', 'Housing'],
      context: 'The Fed targets 2%; readings above 4% have historically required tighter policy for longer.',
    })
  }

  if (core != null && core >= 4) {
    alerts.push({
      id: 'core-4', title: 'Core Inflation Above 4%',
      what: `Core CPI (ex food & energy) is at ${fPct(core)} YoY.`,
      why: 'Core inflation strips out volatile food and energy, so a high reading signals that price pressure is broad and persistent rather than a temporary spike.',
      affected: ['Federal Reserve Policy', 'Bonds', 'Labor'],
      context: 'Core inflation is the gauge the Fed watches most closely when setting rates.',
    })
  }

  if (acceleratingFor(d.cpiYoY, 3)) {
    alerts.push({
      id: 'cpi-accel', title: 'Inflation Accelerating for 3 Straight Months',
      what: `Year-over-year CPI has risen for three consecutive monthly readings (now ${fPct(head)}).`,
      why: 'A sustained re-acceleration is the clearest warning that disinflation has stalled or reversed — exactly what the Fed fears most.',
      affected: ['Federal Reserve Policy', 'Bonds', 'Consumer Spending', 'Credit'],
      context: 'Three months of acceleration has historically preceded a shift to a more hawkish Fed stance.',
    })
  }

  if (wti != null && wti >= 120) {
    alerts.push({
      id: 'wti-shock', title: 'Energy Shock — WTI Above $120',
      what: `WTI crude has surged to ${fUsd(wti)}.`,
      why: 'Oil above $120 is a powerful inflation shock — it lifts gasoline, shipping, and food costs across the whole economy and has historically tipped growth toward recession.',
      affected: ['Consumer Spending', 'Inflation', 'Bonds', 'Federal Reserve Policy'],
      context: 'Oil shocks above $120 contributed to the 1973, 1990, and 2008 downturns.',
    })
  } else if (wti != null && wti >= 100) {
    alerts.push({
      id: 'wti-100', title: 'WTI Crude Above $100',
      what: `WTI crude oil is trading at ${fUsd(wti)}.`,
      why: 'Oil above $100 raises gasoline and shipping costs that flow quickly into headline inflation, and can reignite price pressure even when underlying inflation is cooling.',
      affected: ['Consumer Spending', 'Inflation', 'Bonds'],
      context: 'Oil spikes above $100 contributed to the inflation surges of 2008 and 2022.',
    })
  }

  if (trend?.status === 'Reaccelerating' && !alerts.some(a => a.id === 'cpi-accel')) {
    alerts.push({
      id: 'trend-reaccel', title: 'Inflation Trend Turning Higher',
      what: 'The 3-month annualized pace of core inflation has moved above its yearly rate.',
      why: 'When recent months run hotter than the annual figure, it means the latest data is pulling inflation back up — momentum has shifted the wrong way.',
      affected: ['Federal Reserve Policy', 'Bonds', 'Consumer Spending'],
      context: 'Momentum shifts show up in the 3-month pace months before the year-over-year number reflects them.',
    })
  }

  return alerts
}

// ── Watching closely (never empty) ─────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number; key: string }

function buildWatching(d: InflationData, alerts: InflationAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []
  const head = d.cpiYoY[0]?.value ?? null
  const core = d.coreYoY[0]?.value ?? null
  const wti = d.wti[0]?.value ?? null
  const shelter = d.shelterYoY[0]?.value ?? null

  if (head != null && !firing.has('cpi-4') && !firing.has('cpi-5') && !firing.has('cpi-severe')) {
    items.push({ label: 'CPI (YoY)', text: `${(4 - head).toFixed(1)}% from the 4% alert threshold`, proximity: Math.max(0, Math.min(1, head / 4)), key: 'current' })
  }
  if (core != null && !firing.has('core-4')) {
    items.push({ label: 'Core CPI (YoY)', text: `${(4 - core).toFixed(1)}% from the 4% warning level`, proximity: Math.max(0, Math.min(1, core / 4)), key: 'current' })
  }
  if (wti != null && !firing.has('wti-100') && !firing.has('wti-shock')) {
    items.push({ label: 'WTI Crude', text: `${fUsd(100 - wti)} from the $100 alert level`, proximity: Math.max(0, Math.min(1, wti / 100)), key: 'energy' })
  }
  if (shelter != null) {
    items.push({ label: 'Shelter Inflation', text: shelter >= 5 ? 'above the 5% persistence threshold' : `${(5 - shelter).toFixed(1)}% from the persistence threshold`, proximity: Math.max(0, Math.min(1, shelter / 5)), key: 'consumer' })
  }

  return items.sort((a, b) => b.proximity - a.proximity).slice(0, 5)
}

// ── Biggest risk / biggest stabilizer ──────────────────────────────────
const RISK_PHRASE: Record<string, string> = {
  'current:High Inflation': 'Inflation remains well above target, eroding household purchasing power.',
  'current:Persistent': 'Inflation is proving sticky and remains clearly above the 2% target.',
  'trend:Reaccelerating': 'The recent pace of inflation is picking up — momentum has turned the wrong way.',
  'trend:Stalled': 'Progress on inflation has stalled; the recent pace is no longer falling.',
  'energy:Energy Shock Risk': 'Surging energy prices could push headline inflation sharply higher.',
  'energy:Rising Pressure': 'Rising energy prices threaten to reignite broader inflation pressures.',
  'consumer:Affordability Pressure': 'Shelter and food costs are squeezing household budgets directly.',
  'consumer:Persistent': 'Sticky shelter costs are keeping inflation elevated for everyday consumers.',
}
const STAB_PHRASE: Record<string, string> = {
  'trend:Improving': 'The recent pace of inflation continues to trend lower across most categories.',
  'energy:Low Pressure': 'Stable, low energy prices are keeping a lid on headline inflation.',
  'energy:Normal': 'Energy prices are well-behaved, limiting upside inflation risk.',
  'current:Near Target': 'Inflation is running close to the Fed’s 2% target.',
  'consumer:Normalizing': 'Shelter and food costs are normalizing toward pre-pandemic norms.',
}
const STAB_PREF = ['trend', 'energy', 'current', 'consumer']

const RISK_WHY: Record<string, string> = {
  current: 'When prices rise faster than wages, every dollar buys less — and the Fed keeps rates high, making mortgages, cars, and credit cards more expensive.',
  trend: 'Inflation’s direction matters more than its level: if recent months are running hot, the improvement everyone’s counting on may not arrive.',
  energy: 'Energy feeds into almost everything — gas, shipping, food — so an oil spike can undo months of disinflation and hit consumers fast.',
  consumer: 'Shelter and food are the costs households feel most, so when they stay high, inflation keeps feeling painful even if the headline number eases.',
}
const STAB_WHY: Record<string, string> = {
  trend: 'A cooling recent pace is the best early sign that inflation is genuinely heading back toward target.',
  energy: 'Calm energy prices remove the most common trigger for a sudden inflation flare-up.',
  current: 'Inflation near target means the Fed can ease policy, lowering borrowing costs across the economy.',
  consumer: 'Normalizing shelter and food costs are what finally make everyday life feel affordable again.',
}

export type Callout = { text: string; why: string; key: string }

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: Callout; stabilizer: Callout } {
  const worst = [...cats].sort((a, b) => {
    const r = TONE_RANK[b.tone] - TONE_RANK[a.tone]
    return r !== 0 ? r : PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)
  })[0]
  const useWatch = !(worst && TONE_RANK[worst.tone] >= 2)
  const riskText = !useWatch
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label}: ${worst.status.toLowerCase()}.`)
    : watching[0] ? `${watching[0].label} approaching its alert — ${watching[0].text}.` : 'No major inflation risks building right now.'
  const riskKey = useWatch ? (watching[0]?.key ?? worst?.key ?? '') : worst.key

  const goods = cats.filter(c => c.tone === 'good')
  let best: Category | undefined
  if (goods.length) {
    best = [...goods].sort((a, b) => STAB_PREF.indexOf(a.key) - STAB_PREF.indexOf(b.key))[0]
  } else {
    // Nothing is genuinely calm — surface the least-pressing theme, but never
    // the same theme as the biggest risk, and phrase it honestly.
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

function buildLastAlert(d: InflationData): string | null {
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  // Most recent month headline CPI was at/above 4%.
  const hi = d.cpiYoY.find(o => o.value >= 4)
  // Most recent day WTI was at/above $100.
  const oil = d.wti.find(o => o.value >= 100)
  const candidates: { date: string; text: string }[] = []
  if (hi) candidates.push({ date: hi.date, text: `CPI was last at or above 4% in ${new Date(hi.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}.` })
  if (oil) candidates.push({ date: oil.date, text: `WTI crude last exceeded $100 on ${fmtDate(oil.date)}.` })
  if (candidates.length) return candidates.sort((a, b) => +new Date(b.date) - +new Date(a.date))[0].text
  // Otherwise the headline CPI peak in the window — a real, dated reference.
  if (d.cpiYoY.length) {
    let peak = d.cpiYoY[0]
    for (const o of d.cpiYoY) if (o.value > peak.value) peak = o
    return `Inflation has cooled — headline CPI peaked at ${fPct(peak.value)} in ${new Date(peak.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}.`
  }
  return null
}

// ── Summary generator (75–125 words, deterministic) ────────────────────
function buildSummary(d: InflationData, cats: Category[], risk: Callout): string {
  const head = d.cpiYoY[0]?.value ?? null
  const core = d.coreYoY[0]?.value ?? null
  const shelter = d.shelterYoY[0]?.value ?? null
  const trend = cats.find(c => c.key === 'trend')
  const energy = cats.find(c => c.key === 'energy')

  const dir = trend?.status === 'Improving' ? 'continues to ease from recent highs'
    : trend?.status === 'Reaccelerating' ? 'has started to pick back up'
    : trend?.status === 'Stalled' ? 'has stopped improving and is proving stubborn'
    : 'is holding roughly steady'
  const s1 = head != null
    ? `Inflation ${dir}, with headline CPI at ${fPct(head)}${head > 2.5 ? ' — still above the Fed’s 2% target' : ' — close to the Fed’s 2% target'}.`
    : `Inflation ${dir}.`
  const s2 = core != null
    ? `Core inflation${core >= 3.5 ? ' remains persistent at ' : ' sits at '}${fPct(core)}, while energy costs are ${(energy?.status === 'Low Pressure' || energy?.status === 'Normal') ? 'stable, preventing a broader reacceleration' : 'rising and adding fresh upward pressure'}.`
    : ''
  const s3 = shelter != null && shelter >= 3.5
    ? `Shelter costs continue to contribute disproportionately to overall inflation, limiting progress toward price stability.`
    : shelter != null
    ? `Shelter costs are finally normalizing, helping the broader trend improve.`
    : ''
  // What it means for policy — the lever most readers actually feel.
  const s4 = head != null && head > 2.6
    ? `With inflation still above target, the Federal Reserve has little room to cut rates, keeping borrowing costs elevated for households and businesses.`
    : `With inflation near target, the Federal Reserve has more room to ease policy and lower borrowing costs.`
  const s5 = `The primary risk: ${/^[A-Z][A-Z.]/.test(risk.text) ? risk.text : risk.text.charAt(0).toLowerCase() + risk.text.slice(1)}`
  return [s1, s2, s3, s4, s5].filter(Boolean).join(' ')
}

// ── Public entry point ──────────────────────────────────────────────────
export type InflationModel = {
  available: boolean
  status: InflationStatus
  subtitle: string
  summary: string
  risk: Callout
  stabilizer: Callout
  categories: Category[]
  alerts: InflationAlert[]
  lastAlert: string | null
  watching: WatchItem[]
}

const SUBTITLES: Record<string, string> = {
  'Near Target': 'Inflation is running close to the Fed’s 2% goal.',
  'Disinflation Progress': 'Inflation is cooling steadily back toward target.',
  'Elevated but Improving': 'Inflation is still above target but clearly heading lower.',
  'Inflation Moderating': 'Price pressures are easing across most categories.',
  'Mixed Signals': 'The inflation picture is mixed — no clear direction yet.',
  'Sticky Inflation': 'Inflation is proving stubborn and slow to fall further.',
  'Inflation Stalled': 'Progress on inflation has stalled out above target.',
  'Persistent Price Pressure': 'Everyday costs are keeping inflation elevated.',
  'Inflation Reaccelerating': 'Inflation has turned higher again — momentum is rising.',
  'Broad Price Pressure': 'Price pressure is broad-based and above target.',
  'Inflation Risk Rising': 'The risk of higher inflation is building.',
  'Inflation Alert': 'Inflation is severely elevated.',
  'Renewed Inflation Surge': 'A fresh inflation surge is underway.',
  'Data Unavailable': 'Live inflation data is temporarily unavailable.',
}

export async function buildInflationModel(): Promise<InflationModel> {
  const data = await fetchInflationData()

  // CPI is the keystone — if it's missing, don't fabricate a status.
  if (data.cpiYoY[0]?.value == null) {
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      summary: 'Live inflation data is temporarily unavailable. Check back shortly.',
      risk: { text: '', why: '', key: '' }, stabilizer: { text: '', why: '', key: '' },
      categories: [], alerts: [], lastAlert: null, watching: [],
    }
  }

  const categories = [scoreCurrent(data), scoreTrend(data), scoreEnergy(data), scoreConsumer(data)].map(withFill)
  const status = overallStatus(categories)
  const alerts = buildAlerts(data, categories)
  const watching = buildWatching(data, alerts)
  const { risk, stabilizer } = riskAndStabilizer(categories, watching)

  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    summary: buildSummary(data, categories, risk),
    risk, stabilizer, categories, alerts,
    lastAlert: buildLastAlert(data),
    watching,
  }
}
