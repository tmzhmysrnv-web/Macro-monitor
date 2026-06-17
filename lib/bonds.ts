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
import { toneHigh, toneLow } from './metricTone'
import { getLastFomc, getNextFomc } from './fetchCalendar'

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

export type MetricCard = {
  label: string; value: string; sub?: string; unit?: string
  tone?: Tone
  points?: { date: string; value: number }[]
  pctl?: number; histLabel?: string
  alertText?: string; alertProximity?: number
}

// Where the latest value sits within its own fetched history → "historically …".
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

// Distance to an upper alert threshold (for metrics that can trip an alert).
function alertAbove(value: number | null, threshold: number, unit = '%'): { alertText?: string; alertProximity?: number } {
  if (value == null || value >= threshold) return {}
  return { alertText: `${(threshold - value).toFixed(2)}${unit} from ${threshold}${unit} alert`, alertProximity: Math.max(0, Math.min(1, value / threshold)) }
}

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
  termPremium: number | null     // 10Y ACM term premium (THREEFYTP10) — duration-demand gauge
  termPremiumChg3m: number | null
  termPremiumObs: Obs[]
  foreignHoldings: number | null // foreign-held federal debt ($B)
  foreignSharePct: number | null // foreign holdings as % of total US debt
  foreignShareYoY: number | null // change in that share vs ~1y ago (pp)
  foreignHoldingsObs: Obs[]
  thirtYMax: number | null       // max 30Y over the long window (multi-decade high)
  spread3m10History: Obs[]       // for uninversion detection + sparkline
  tenYHistory: Obs[]             // for the 5% alert lookback + sparkline
  twoYObs: Obs[]
  thirtYObs: Obs[]
  realYieldObs: Obs[]
  fedFundsObs: Obs[]
  spread2_10Obs: Obs[]
  debtObs: Obs[]
  targetUpper: number | null     // DFEDTARU — daily upper bound of the fed-funds target range
  targetLower: number | null     // DFEDTARL — lower bound (for the target midpoint)
  effr: number | null            // DFF — daily effective fed funds rate (futures math)
  targetObs: Obs[]               // for clean policy-step detection (banner)
}

export async function fetchBondData(): Promise<BondData> {
  const [dgs10, dgs30, dgs2, dgs3mo, dfii10, ff, t10y2y, t10y3m, debt, tp, foreign, totalDebt, target, targetLo, effrObs] = await Promise.all([
    fredSeries('DGS10', 1300),    // ~5y daily — vol, trend, alert lookback, sparkline, percentile
    fredSeries('DGS30', 9000),    // long window for the multi-decade-high check
    fredSeries('DGS2', 1300),
    fredSeries('DGS3MO', 5),
    fredSeries('DFII10', 1300),   // 10Y real yield (TIPS)
    fredSeries('FEDFUNDS', 240),  // ~20y monthly
    fredSeries('T10Y2Y', 1300),
    fredSeries('T10Y3M', 1300),   // spread + history for uninversion + percentile
    fredSeries('GFDEGDQ188S', 44), // public debt as % of GDP (quarterly)
    fredSeries('THREEFYTP10', 1300), // 10Y ACM term premium (daily)
    fredSeries('FDHBFIN', 44),    // foreign-held federal debt ($B, quarterly)
    fredSeries('GFDEBTN', 60),    // total public debt ($M, quarterly) — for foreign share
    fredSeries('DFEDTARU', 2600), // daily fed-funds target upper (~10y) — steps exactly on decision day
    fredSeries('DFEDTARL', 5),    // target lower bound (for the midpoint)
    fredSeries('DFF', 5),         // daily effective fed funds rate (futures math)
  ])

  // Foreign share of total debt — date-aligned (FDHBFIN lags GFDEBTN by ~1 quarter).
  const totalAt = (date?: string) => date ? (totalDebt.find(o => o.date === date)?.value ?? null) : null
  const shareAt = (fh?: Obs) => {
    const tot = totalAt(fh?.date)
    return fh != null && tot ? (fh.value * 1000) / tot * 100 : null
  }
  const foreignSharePct = shareAt(foreign[0]) != null ? parseFloat((shareAt(foreign[0]) as number).toFixed(1)) : null
  const shareYrAgo = shareAt(foreign[4])
  const foreignShareYoY = foreignSharePct != null && shareYrAgo != null ? parseFloat((foreignSharePct - shareYrAgo).toFixed(1)) : null

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
    termPremium: tp[0]?.value ?? null,
    termPremiumChg3m: chgDaysBack(tp, 91),
    termPremiumObs: tp,
    foreignHoldings: foreign[0]?.value ?? null,
    foreignSharePct,
    foreignShareYoY,
    foreignHoldingsObs: foreign,
    thirtYMax: dgs30.length ? Math.max(...dgs30.map(o => o.value)) : null,
    spread3m10History: t10y3m,
    tenYHistory: dgs10,
    twoYObs: dgs2,
    thirtYObs: dgs30,
    realYieldObs: dfii10,
    fedFundsObs: ff,
    spread2_10Obs: t10y2y,
    debtObs: debt,
    targetUpper: target[0]?.value ?? null,
    targetLower: targetLo[0]?.value ?? null,
    effr: effrObs[0]?.value ?? null,
    targetObs: target,
  }
}

// ── Fed Policy event (the banner) ─────────────────────────────────────
// Rate decisions are events, not statistics. Detected from the DAILY target
// upper bound, which steps cleanly on decision day (the monthly effective rate
// lags by up to a month and smears the step). Pairs with the FOMC calendar to
// say whether the latest meeting actually moved or held.
export type FedPolicyData = {
  currentRate: number | null
  lastChangeAmount: number              // signed pp, e.g. +0.25 / −0.25 (0 if none found)
  lastChangeDirection: 'hike' | 'cut' | 'none'
  lastChangeDate: string | null
  daysSinceChange: number | null
  latestMeetingResult: string           // "No Change" | "+0.25%" | "−0.25%"
  fresh: boolean                        // moved within the last few days → breaking-news state
  history: { date: string; value: number }[]  // rate path, for the banner context line
}

function buildFedPolicy(obs: Obs[]): FedPolicyData {
  const lastFomc = getLastFomc()
  const history = spark(obs, 80) ?? []   // oldest→newest target-rate path (~10y)
  const none: FedPolicyData = {
    currentRate: obs[0]?.value ?? null, lastChangeAmount: 0, lastChangeDirection: 'none',
    lastChangeDate: null, daysSinceChange: null, latestMeetingResult: 'No Change', fresh: false, history,
  }
  if (obs.length < 2) return none

  // obs are newest-first; the first place the value differs from the prior day
  // is the most recent step (a hike or a cut).
  let i = 0
  while (i + 1 < obs.length && obs[i].value === obs[i + 1].value) i++
  if (i + 1 >= obs.length) return none

  const amount = parseFloat((obs[i].value - obs[i + 1].value).toFixed(2))
  if (amount === 0) return none
  const changeDate = obs[i].date
  const daysSinceChange = Math.round((Date.now() - new Date(changeDate + 'T00:00:00').getTime()) / 86400000)
  // The latest meeting "moved" if its date lines up with this step (±5 days);
  // otherwise the most recent decision was a hold.
  const movedAtLastMeeting = lastFomc != null &&
    Math.abs(new Date(changeDate).getTime() - new Date(lastFomc.date).getTime()) / 86400000 <= 5
  const signed = `${amount > 0 ? '+' : '−'}${Math.abs(amount).toFixed(2)}%`
  return {
    currentRate: obs[0].value,
    lastChangeAmount: amount,
    lastChangeDirection: amount > 0 ? 'hike' : 'cut',
    lastChangeDate: changeDate,
    daysSinceChange,
    latestMeetingResult: movedAtLastMeeting ? signed : 'No Change',
    fresh: daysSinceChange <= 5,
    history,
  }
}

// ── Market rate expectation (internal proxy for CME FedWatch) ─────────
// NOT rendered on the site. CME blocks scraping and prohibits it in their ToS,
// and there's no free probabilities API — so this is a free, ToS-clean stand-in:
// the 2-year Treasury embeds the market's expected average path of the policy
// rate, so 2Y vs the policy rate just before a decision reveals what the market
// was pricing, letting us flag when an actual move SURPRISED the market. Carried
// in the API payload for later use; no UI swap needed if a licensed feed arrives.
export type RateExpectation = {
  method: 'futures' | 'treasury' | 'none'
  expectedDirection: 'cut' | 'hike' | 'hold'
  surprise: boolean
  probabilities?: { cut50: number; cut25: number; hold: number; hike25: number }  // %, futures method only
  impliedRate?: number          // implied post-meeting rate (futures)
  meetingDate?: string
  basis: string
}

// Latest price for a Yahoo symbol (used for the 30-day fed-funds future ZQ=F).
async function yahooPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`
    const res = await fetch(url, { next: { revalidate: 900 } })
    if (!res.ok) return null
    const data = await res.json()
    const p = data?.chart?.result?.[0]?.meta?.regularMarketPrice
    return typeof p === 'number' ? p : null
  } catch { return null }
}

// Fallback proxy: the 2Y embeds the ~2-year average path, so 2Y vs the policy
// rate gives a coarse direction when the futures method isn't applicable.
function expectationFromTreasury(twoYObs: Obs[], fp: FedPolicyData): RateExpectation {
  const dir = fp.lastChangeDirection
  const preRate = fp.currentRate != null ? fp.currentRate - fp.lastChangeAmount : null
  const preTwoY = valueDaysBack(twoYObs, (fp.daysSinceChange ?? 0) + 5) ?? twoYObs[0]?.value ?? null
  if (preTwoY == null || preRate == null) return { method: 'none', expectedDirection: 'hold', surprise: false, basis: 'insufficient data' }
  const gap = parseFloat((preTwoY - preRate).toFixed(2))
  const expectedDirection: RateExpectation['expectedDirection'] = gap <= -0.25 ? 'cut' : gap >= 0.25 ? 'hike' : 'hold'
  return {
    method: 'treasury', expectedDirection,
    surprise: fp.fresh && dir !== 'none' && dir !== expectedDirection,
    basis: `2Y ${gap >= 0 ? '+' : ''}${gap}pp vs policy rate → medium-term direction ${expectedDirection} (no next-meeting futures)`,
  }
}

// CME-FedWatch-style: the 30-day fed-funds future settles to the month's AVERAGE
// daily EFFR. Split the meeting month into before/after the decision, back out
// the implied post-meeting rate, then map it onto the 25bp outcome ladder for
// hold/cut/hike probabilities. Works when the next meeting is in the current
// month (front-month ZQ isolates it); otherwise falls back to the 2Y proxy.
async function buildRateExpectation(d: BondData, fp: FedPolicyData): Promise<RateExpectation> {
  const next = getNextFomc()
  const now = new Date()
  const sameMonth = next != null && (() => {
    const m = new Date(next.date + 'T12:00:00Z')
    return m.getUTCFullYear() === now.getUTCFullYear() && m.getUTCMonth() === now.getUTCMonth()
  })()

  if (next && sameMonth && d.targetUpper != null && d.targetLower != null && d.effr != null) {
    // Dated meeting-month contract — the continuous ZQ=F rolls and isn't reliably
    // the meeting month (it priced 3.72% when the June contract was 3.62%).
    // Symbol: ZQ + futures month-code + 2-digit year.
    const codes = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z']
    const md = new Date(next.date + 'T12:00:00Z')
    const contract = `ZQ${codes[md.getUTCMonth()]}${String(md.getUTCFullYear()).slice(2)}.CBT`
    const meetingDay = parseInt(next.date.slice(8, 10), 10)
    const daysTotal = new Date(md.getUTCFullYear(), md.getUTCMonth() + 1, 0).getDate()
    const daysBefore = meetingDay - 1
    const daysAfter = daysTotal - daysBefore
    const price = await yahooPrice(contract)
    // Need enough post-meeting days for a stable back-out — the /daysAfter term
    // amplifies error, so skip meetings in the last few days of their month.
    if (price != null && daysAfter >= 5) {
      const monthlyRate = 100 - price
      const mid = (d.targetUpper + d.targetLower) / 2
      const afterRate = (monthlyRate * daysTotal - d.effr * daysBefore) / daysAfter

      const ladder = [
        { k: 'cut50', r: mid - 0.50 }, { k: 'cut25', r: mid - 0.25 },
        { k: 'hold', r: mid }, { k: 'hike25', r: mid + 0.25 }, { k: 'hike50', r: mid + 0.50 },
      ] as const
      const clamped = Math.max(ladder[0].r, Math.min(ladder[ladder.length - 1].r, afterRate))
      const raw: Record<string, number> = { cut50: 0, cut25: 0, hold: 0, hike25: 0, hike50: 0 }
      for (let i = 0; i < ladder.length - 1; i++) {
        if (clamped >= ladder[i].r && clamped <= ladder[i + 1].r) {
          const f = (clamped - ladder[i].r) / (ladder[i + 1].r - ladder[i].r)
          raw[ladder[i + 1].k] = f; raw[ladder[i].k] = 1 - f
          break
        }
      }
      const pct = (x: number) => Math.round(x * 1000) / 10
      const probabilities = { cut50: pct(raw.cut50), cut25: pct(raw.cut25), hold: pct(raw.hold), hike25: pct(raw.hike25 + raw.hike50) }
      const top = (Object.entries(raw).sort((a, b) => b[1] - a[1])[0] || ['hold'])[0]
      const expectedDirection: RateExpectation['expectedDirection'] = top === 'hold' ? 'hold' : top.startsWith('cut') ? 'cut' : 'hike'
      return {
        method: 'futures', expectedDirection,
        // Only a FRESH actual move that contradicts the expectation is a surprise —
        // not a stale prior move vs the current baseline.
        surprise: fp.fresh && fp.lastChangeDirection !== 'none' && fp.lastChangeDirection !== expectedDirection,
        probabilities, impliedRate: parseFloat(afterRate.toFixed(3)), meetingDate: next.date,
        basis: `${contract} implies ${afterRate.toFixed(3)}% post-meeting vs ${mid.toFixed(3)}% mid → ${probabilities.hold}% hold`,
      }
    }
  }
  return expectationFromTreasury(d.twoYObs, fp)
}

// ── Watch List Activated ──────────────────────────────────────────────
// When the Fed moves, temporarily track the areas most likely to feel it —
// answering "what should I be watching now?" rather than stopping at the event.
// Each item measures its indicator's move SINCE the decision date.
export type WatchStatus = 'monitoring' | 'impact' | 'stabilized'
export type FedWatchItem = {
  key: string; label: string; icon: string
  status: WatchStatus
  severity: 'none' | 'amber' | 'red'
  detail: string
}
export type FedWatch = {
  active: boolean
  eventType: 'hike' | 'cut' | null
  items: FedWatchItem[]
  impactCount: number
  total: number
}

type WatchCfg = { key: string; label: string; icon: string; series: string; dir: 'up' | 'down'; amber: number; red: number; kind: 'pp' | 'claims' | 'pct'; noun: string }

// What a hike vs a cut tends to hit first. Thresholds are moves SINCE the
// decision, in each metric's own units (pp, thousands of claims, or %).
const HIKE_WATCH: WatchCfg[] = [
  { key: 'mortgage',   label: 'Mortgage Rates',  icon: 'home',       series: 'MORTGAGE30US',  dir: 'up', amber: 0.20, red: 0.50, kind: 'pp',     noun: '30-year mortgage average' },
  { key: 'treasury',   label: 'Treasury Yields', icon: 'chart-line', series: 'DGS10',         dir: 'up', amber: 0.20, red: 0.50, kind: 'pp',     noun: '10-year yield' },
  { key: 'employment', label: 'Employment',      icon: 'briefcase',  series: 'ICSA',          dir: 'up', amber: 25,   red: 60,   kind: 'claims', noun: 'jobless claims' },
  { key: 'inflation',  label: 'Inflation',       icon: 'flame',      series: 'CPIAUCSL',      dir: 'up', amber: 0.3,  red: 0.7,  kind: 'pp',     noun: 'inflation (CPI YoY)' },
  { key: 'credit',     label: 'Bank Lending',    icon: 'bank',       series: 'BAMLH0A0HYM2',  dir: 'up', amber: 0.5,  red: 1.5,  kind: 'pp',     noun: 'high-yield spreads' },
]
const CUT_WATCH: WatchCfg[] = [
  { key: 'treasury',   label: 'Treasury Yields', icon: 'chart-line', series: 'DGS10',         dir: 'down', amber: 0.20, red: 0.50, kind: 'pp',  noun: '10-year yield' },
  { key: 'bankstress', label: 'Bank Stress',     icon: 'bank',       series: 'BAMLH0A0HYM2',  dir: 'up',   amber: 0.5,  red: 1.5,  kind: 'pp',  noun: 'high-yield spreads' },
  { key: 'equity',     label: 'Equity Markets',  icon: 'activity',   series: 'SP500',         dir: 'up',   amber: 3,    red: 7,    kind: 'pct', noun: 'S&P 500' },
  { key: 'dollar',     label: 'Dollar Strength', icon: 'globe',      series: 'DTWEXBGS',      dir: 'down', amber: 1,    red: 3,    kind: 'pct', noun: 'broad dollar index' },
]

function buildWatchItem(c: WatchCfg, obs: Obs[], daysSince: number): FedWatchItem {
  const mon: FedWatchItem = { key: c.key, label: c.label, icon: c.icon, status: 'monitoring', severity: 'none', detail: 'monitoring for movement' }
  if (!obs || obs.length < 2) return mon
  const cur = obs[0].value
  const base = valueDaysBack(obs, Math.max(1, daysSince)) ?? obs[obs.length - 1].value
  if (base === 0 && c.kind === 'pct') return mon
  const raw = c.kind === 'claims' ? (cur - base) / 1000
    : c.kind === 'pct' ? (cur - base) / Math.abs(base) * 100
    : cur - base
  const dirMag = c.dir === 'up' ? raw : -raw          // movement in the "impact" direction
  const dp = c.kind === 'claims' ? 0 : 2
  const unit = c.kind === 'pct' ? '%' : c.kind === 'claims' ? 'k' : '%'
  const word = raw >= 0 ? 'rose' : 'fell'
  const detail = `${c.noun} ${word} ${Math.abs(raw).toFixed(dp)}${unit}`
  if (dirMag >= c.red)   return { ...mon, status: 'impact', severity: 'red',   detail }
  if (dirMag >= c.amber) return { ...mon, status: 'impact', severity: 'amber', detail }
  if (daysSince >= 30)   return { ...mon, status: 'stabilized', severity: 'none', detail: 'stable — no meaningful move since the decision' }
  return mon
}

async function buildFedWatch(fp: FedPolicyData, tenYHistory: Obs[]): Promise<FedWatch> {
  const cfgs = fp.lastChangeDirection === 'hike' ? HIKE_WATCH : CUT_WATCH
  const days = fp.daysSinceChange ?? 0
  const seriesData = await Promise.all(cfgs.map(c =>
    c.series === 'DGS10' ? Promise.resolve(tenYHistory)
      : fredSeries(c.series, 400, c.series === 'CPIAUCSL' ? 'pc1' : 'lin')))
  const items = cfgs.map((c, i) => buildWatchItem(c, seriesData[i], days))
  return {
    active: true,
    eventType: fp.lastChangeDirection as 'hike' | 'cut',
    items,
    impactCount: items.filter(it => it.status === 'impact').length,
    total: items.length,
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
    { label: '2Y–10Y Spread', value: fSpread(s210), unit: '%', tone: toneLow(s210, 0, -0.5), points: spark(d.spread2_10Obs), ...hist(d.spread2_10Obs), sub: s210 != null && s210 < 0 ? 'inverted' : undefined },
    { label: '3M–10Y Spread', value: fSpread(s310), unit: '%', tone: toneLow(s310, 0, -0.5), points: spark(d.spread3m10History), ...hist(d.spread3m10History), sub: s310 != null && s310 < 0 ? 'inverted' : undefined },
    { label: '10Y Yield', value: fPct(d.tenY), unit: '%', tone: toneHigh(d.tenY, 5, 6), points: spark(d.tenYHistory), ...hist(d.tenYHistory), sub: d.tenYChg3m != null ? `${d.tenYChg3m >= 0 ? '+' : ''}${d.tenYChg3m}pp 3mo` : undefined },
    { label: '2Y Yield', value: fPct(d.twoY), unit: '%', points: spark(d.twoYObs), ...hist(d.twoYObs) },
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
    { label: '10Y Treasury', value: fPct(ten), unit: '%', tone: toneHigh(ten, 5, 6), points: spark(d.tenYHistory), ...hist(d.tenYHistory), ...alertAbove(ten, 5) },
    { label: '30Y Treasury', value: fPct(d.thirtY), unit: '%', tone: toneHigh(d.thirtY, 6, 7), points: spark(d.thirtYObs), ...hist(d.thirtYObs), ...alertAbove(d.thirtY, 6) },
    { label: '10Y Real Yield', value: fPct(ry), unit: '%', tone: toneHigh(ry, 2.5, 3.5), points: spark(d.realYieldObs), ...hist(d.realYieldObs), sub: 'TIPS' },
    { label: 'Fed Funds', value: fPct(d.fedFunds), unit: '%', points: spark(d.fedFundsObs), ...hist(d.fedFundsObs) },
  ]
  return { key: 'rates', label: 'Interest Rate Environment', status, tone, signals, metrics }
}

// 3 ── Government Financing (fiscal / Treasury financing stress) ───────
function scoreFinancing(d: BondData): Omit<Category, 'fill'> {
  const signals: string[] = []
  const t30 = d.thirtY
  const tp = d.termPremium
  const nearMultiDecadeHigh = t30 != null && d.thirtYMax != null && t30 >= d.thirtYMax - 0.1
  if (t30 != null) signals.push(`30Y Treasury at ${fPct(t30)}${nearMultiDecadeHigh ? ' — near a multi-decade high' : ''}`)
  if (tp != null) signals.push(`10Y term premium at ${fPct(tp)}${d.termPremiumChg3m != null && d.termPremiumChg3m >= 0.15 ? ' and rising' : ''} — the extra yield investors demand to hold long Treasuries${tp >= 0.5 ? ', a sign structural demand (including foreign central banks like Japan and China) is fading' : ''}`)
  if (d.foreignSharePct != null) signals.push(`Foreign investors hold ${d.foreignSharePct.toFixed(0)}% of U.S. debt${d.foreignShareYoY != null ? ` (${d.foreignShareYoY >= 0 ? '+' : ''}${d.foreignShareYoY.toFixed(1)}pp YoY)` : ''}${d.foreignShareYoY != null && d.foreignShareYoY <= -0.5 ? ' — a shrinking share as the U.S. leans more on domestic buyers' : ''}`)
  if (d.debtToGDP != null) signals.push(`Federal debt at ${d.debtToGDP.toFixed(0)}% of GDP`)

  const risingFast = d.thirtYChg3m != null && d.thirtYChg3m >= 0.4
  const tpElevated = tp != null && tp >= 0.75
  const tpHigh = tp != null && tp >= 1.2

  let status: string, tone: Tone
  if ((nearMultiDecadeHigh && risingFast) || tpHigh) { status = 'Financing Warning'; tone = 'crisis' }
  else if (t30 != null && t30 >= 6) { status = 'Fiscal Stress'; tone = 'bad' }
  else if ((t30 != null && (t30 >= 5 || nearMultiDecadeHigh)) || tpElevated) { status = 'Rising Fiscal Pressure'; tone = 'warn' }
  else if (t30 != null && t30 >= 4) { status = 'Manageable'; tone = 'neutral' }
  else { status = 'Stable Financing'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: '30Y Treasury', value: fPct(t30), unit: '%', tone: toneHigh(t30, 6, 7), points: spark(d.thirtYObs), ...hist(d.thirtYObs), ...alertAbove(t30, 6), sub: d.thirtYChg3m != null ? `${d.thirtYChg3m >= 0 ? '+' : ''}${d.thirtYChg3m}pp 3mo` : undefined },
    { label: '10Y Term Premium', value: fPct(tp), unit: '%', tone: toneHigh(tp, 0.5, 1.2), points: spark(d.termPremiumObs), ...hist(d.termPremiumObs), sub: d.termPremiumChg3m != null ? `${d.termPremiumChg3m >= 0 ? '+' : ''}${d.termPremiumChg3m.toFixed(2)}pp 3mo` : 'demand for duration' },
    { label: 'Foreign Holdings', value: d.foreignHoldings != null ? `$${(d.foreignHoldings / 1000).toFixed(1)}T` : '—', sub: d.foreignSharePct != null ? `${d.foreignSharePct.toFixed(0)}% of US debt${d.foreignShareYoY != null ? `, ${d.foreignShareYoY >= 0 ? '+' : ''}${d.foreignShareYoY.toFixed(1)}pp YoY` : ''}` : 'foreign-held', points: spark(d.foreignHoldingsObs) },
    { label: 'Debt-to-GDP', value: d.debtToGDP != null ? `${d.debtToGDP.toFixed(0)}%` : '—', unit: '%', points: spark(d.debtObs), ...hist(d.debtObs) },
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
    { label: '10Y Yield Volatility', value: vol != null ? `${vol} bp/day` : '—', sub: 'realized, 1mo', tone: toneHigh(vol, 8, 13) },
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

  if (d.termPremium != null && d.termPremium >= 1.0) {
    alerts.push({
      id: 'term-premium', title: 'Treasury Term Premium Elevated — Financing Stress',
      what: `The 10-year term premium has risen to ${fPct(d.termPremium)}.`,
      why: 'The term premium is the extra yield investors demand to hold long-term Treasuries. A sharp rise signals that structural demand — including from foreign central banks like Japan and China, which have been net sellers — is fading, pushing the government\'s long-term borrowing costs higher and tightening conditions across markets.',
      affected: ['Government Finance', 'Housing', 'Credit', 'Stock Market'],
      context: 'The term premium spent the 2010s near zero or negative; a sustained move above 1% marks the return of real supply/demand pressure on Treasuries.',
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

  // Fast directional spike in yields — the channel a foreign-selling shock
  // (Japan/China stepping back) hits first. Tier escalates in the title.
  const wkBp = d.tenYHistory.length > 5 ? (d.tenYHistory[0].value - d.tenYHistory[5].value) * 100 : null
  if (wkBp != null && wkBp >= 25) {
    alerts.push({
      id: 'yield-spike', title: wkBp >= 40 ? 'Disorderly Jump in Treasury Yields' : 'Treasury Yields Spiking',
      what: `The 10-year yield has jumped ${Math.round(wkBp)}bp in a week.`,
      why: 'A fast spike in yields — often when large holders such as foreign central banks sell — raises borrowing costs across the economy and can signal waning demand for U.S. debt or a disorderly repricing.',
      affected: ['Government Finance', 'Housing', 'Credit', 'Stock Market'],
      context: 'Sharp yield jumps drove the 2022–23 bond rout and the spring-2025 long-end scare.',
    })
  }

  return alerts
}

// ── Watching closely (never empty) ────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number; key: string }

function buildWatching(d: BondData, alerts: BondAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []

  if (d.tenY != null && !firing.has('tenY-5')) {
    const dist = parseFloat((5 - d.tenY).toFixed(2))
    items.push({ label: '10-Year Treasury', text: `${dist}pp below the 5% alert`, proximity: Math.max(0, Math.min(1, d.tenY / 5)), key: 'rates' })
  }
  if (d.thirtY != null && !firing.has('thirtY-6')) {
    const dist = parseFloat((6 - d.thirtY).toFixed(2))
    items.push({ label: '30-Year Treasury', text: `${dist}pp below the 6% alert`, proximity: Math.max(0, Math.min(1, d.thirtY / 6)), key: 'financing' })
  }
  if (d.termPremium != null && !firing.has('term-premium')) {
    const dist = parseFloat((1.0 - d.termPremium).toFixed(2))
    items.push({ label: 'Term Premium', text: dist > 0 ? `${dist}pp below the 1.0% financing-stress alert` : 'above the financing-stress alert', proximity: Math.max(0, Math.min(1, d.termPremium / 1.0)), key: 'financing' })
  }
  if (d.volBp != null && !firing.has('vol-stress')) {
    const dist = parseFloat((13 - d.volBp).toFixed(1))
    items.push({ label: 'Treasury Volatility', text: `${dist}bp below the stress threshold (13bp)`, proximity: Math.max(0, Math.min(1, d.volBp / 13)), key: 'stress' })
  }
  if (d.spread3m_10 != null && !firing.has('deep-inversion')) {
    const s = d.spread3m_10
    if (s < 0) items.push({ label: 'Yield Curve', text: `${parseFloat((s + 1).toFixed(2))}pp above the deep-inversion alert (−1.0%)`, proximity: Math.max(0, Math.min(1, Math.abs(s) / 1.0)), key: 'growth' })
    else items.push({ label: 'Yield Curve', text: `${fSpread(s)} — positive; watching for re-inversion`, proximity: Math.max(0, Math.min(1, 0.3 - Math.min(0.3, s) / 1)), key: 'growth' })
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

// Plain-English "why this matters" for un-initiated readers, per theme.
const RISK_WHY: Record<string, string> = {
  growth: 'An inverted yield curve means bond investors expect the economy to slow — historically one of the most reliable recession warnings.',
  rates: 'Higher-for-longer rates keep mortgages, car loans, and business borrowing expensive, which weighs on growth.',
  financing: 'Rising government borrowing costs strain the federal budget and push long-term rates higher across the economy.',
  stress: 'When Treasuries — the world’s safe asset — turn volatile, it signals fear spreading through markets.',
}
const STAB_WHY: Record<string, string> = {
  growth: 'A normal, upward-sloping curve points to steady economic growth ahead.',
  rates: 'Easier financing conditions lower borrowing costs for households and businesses.',
  financing: 'Stable government financing keeps long-term rates in check.',
  stress: 'Calm Treasury markets keep the financial system’s anchor steady.',
}

export type Callout = { text: string; why: string; key: string }

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: Callout; stabilizer: Callout } {
  const worst = [...cats].sort((a, b) => TONE_RANK[b.tone] - TONE_RANK[a.tone])[0]
  const useWatch = !(worst && TONE_RANK[worst.tone] >= 2)
  const riskText = !useWatch
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label}: ${worst.status}.`)
    : watching[0]
      ? `${watching[0].label} approaching its alert — ${watching[0].text}.`
      : 'No major bond-market risks building right now.'
  const riskKey = useWatch ? (watching[0]?.key ?? worst?.key ?? '') : worst.key

  const goods = cats.filter(c => c.tone === 'good')
  const pool = goods.length ? goods : [...cats].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
  const best = pool.sort((a, b) => STABILIZER_PREF.indexOf(a.key) - STABILIZER_PREF.indexOf(b.key))[0]
  const stabText = best
    ? (STABILIZER_PHRASE[`${best.key}:${best.status}`] ?? `${best.label} is holding steady.`)
    : 'No clear stabilizers right now.'
  return {
    risk: { text: riskText, why: RISK_WHY[riskKey] ?? '', key: riskKey },
    stabilizer: { text: stabText, why: STAB_WHY[best?.key] ?? '', key: best?.key ?? '' },
  }
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
  risk: Callout
  stabilizer: Callout
  categories: Category[]
  alerts: BondAlert[]
  lastAlert: string | null
  watching: WatchItem[]
  fedPolicy: FedPolicyData
  fedWatch: FedWatch
  rateExpectation: RateExpectation   // internal proxy — not rendered
  data: BondData
}

const INACTIVE_WATCH: FedWatch = { active: false, eventType: null, items: [], impactCount: 0, total: 0 }
const WATCH_WINDOW_DAYS = 60   // how long a Fed move keeps its watch list active

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
    const fp = buildFedPolicy(data.targetObs)
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      risk: { text: '', why: '', key: '' }, stabilizer: { text: '', why: '', key: '' },
      categories: [], alerts: [], lastAlert: null, watching: [], fedPolicy: fp, fedWatch: INACTIVE_WATCH,
      rateExpectation: await buildRateExpectation(data, fp), data,
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
  const fedPolicy = buildFedPolicy(data.targetObs)

  // Activate the watch list only inside the post-decision window — so the extra
  // impact-series fetches happen for ~60 days after a move, not on every load.
  const fedWatch = fedPolicy.lastChangeDirection !== 'none'
    && fedPolicy.daysSinceChange != null && fedPolicy.daysSinceChange <= WATCH_WINDOW_DAYS
    ? await buildFedWatch(fedPolicy, data.tenYHistory)
    : INACTIVE_WATCH

  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    risk, stabilizer,
    categories, alerts,
    lastAlert: buildLastAlert(data),
    watching, fedPolicy, fedWatch,
    rateExpectation: await buildRateExpectation(data, fedPolicy),
    data,
  }
}
