// lib/markets.ts
// Markets intelligence model. Answers one question: "what level of risk are
// investors willing to take?". Four themes — Market Trend, Risk Appetite,
// Volatility & Fear, Market Participation — scored on real market data; the
// overall status reflects investor PSYCHOLOGY, not price performance alone.
//
// Data: Yahoo Finance daily history (no key). Metric notes — true breadth
// (advance/decline line, % of stocks above 200-DMA, new-highs/lows) has no
// free real-time source, so Participation is proxied by equal-weight vs
// cap-weight relative performance (RSP vs SPY) — the standard free read on
// whether gains are broad or concentrated.

import { toneHigh, toneLow, type Tone as MetricTone } from './metricTone'

export type Obs = { date: string; value: number }

// Yahoo daily close history, newest-first (desc), to match the card helpers.
async function yahooHistory(symbol: string, range = '1y'): Promise<Obs[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`
    const res = await fetch(url, { next: { revalidate: 3600 } })
    if (!res.ok) return []
    const data = await res.json()
    const r = data?.chart?.result?.[0]
    const ts: number[] = r?.timestamp ?? []
    const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? []
    const out: Obs[] = []
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: closes[i] as number })
    }
    return out.reverse() // newest first
  } catch { return [] }
}

// ── numeric helpers ───────────────────────────────────────────────────
const sma = (obs: Obs[], n: number): number | null => obs.length < n ? null : obs.slice(0, n).reduce((a, o) => a + o.value, 0) / n
// trailing-window drawdown from the highest close (%), e.g. -12 = 12% off the high
function drawdown(obs: Obs[]): number | null {
  if (obs.length < 2) return null
  const peak = Math.max(...obs.map(o => o.value))
  return parseFloat(((obs[0].value / peak - 1) * 100).toFixed(1))
}
// % return over the last ~n trading days
function ret(obs: Obs[], n: number): number | null {
  if (obs.length <= n || obs[n].value === 0) return null
  return (obs[0].value / obs[n].value - 1) * 100
}
// relative performance of A vs B over n days (pp). Positive = A outperforming.
function relPerf(a: Obs[], b: Obs[], n = 63): number | null {
  const ra = ret(a, n), rb = ret(b, n)
  if (ra == null || rb == null) return null
  return parseFloat((ra - rb).toFixed(1))
}
// annualized realized volatility (%) from the last n daily log returns
function realizedVol(obs: Obs[], n = 21): number | null {
  if (obs.length < n + 1) return null
  const r: number[] = []
  for (let i = 0; i < n; i++) r.push(Math.log(obs[i].value / obs[i + 1].value))
  const mean = r.reduce((a, b) => a + b, 0) / r.length
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length
  return parseFloat((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(1))
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
function alertAbove(value: number | null, threshold: number, unit = ''): { alertText?: string; alertProximity?: number } {
  if (value == null || value >= threshold) return {}
  return { alertText: `${(threshold - value).toFixed(1)}${unit} from ${threshold}${unit} alert`, alertProximity: Math.max(0, Math.min(1, value / threshold)) }
}

const fNum = (v: number | null) => v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 0 })
const fPct = (v: number | null, d = 1) => v == null ? '—' : `${v.toFixed(d)}%`
const fRel = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`

export type MarketsData = {
  spx: Obs[]; nasdaq: Obs[]; vix: Obs[]
  rut: Obs[]; rsp: Obs[]; spy: Obs[]; cyc: Obs[]; def: Obs[]
}

export async function fetchMarketsData(): Promise<MarketsData> {
  const [spx, nasdaq, vix, rut, rsp, spy, cyc, def] = await Promise.all([
    yahooHistory('^GSPC'),   // S&P 500
    yahooHistory('^IXIC'),   // Nasdaq Composite
    yahooHistory('^VIX'),    // VIX
    yahooHistory('^RUT'),    // Russell 2000 (small caps)
    yahooHistory('RSP'),     // equal-weight S&P (breadth proxy)
    yahooHistory('SPY'),     // cap-weight S&P
    yahooHistory('XLY'),     // consumer discretionary (cyclical)
    yahooHistory('XLP'),     // consumer staples (defensive)
  ])
  return { spx, nasdaq, vix, rut, rsp, spy, cyc, def }
}

// ── Category scoring ──────────────────────────────────────────────────
export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
export type Category = {
  key: string; label: string; status: string; tone: Tone; fill: number
  signals: string[]; metrics: MetricCard[]
}
const TONE_FILL: Record<Tone, number> = { good: 0.9, neutral: 0.55, warn: 0.4, bad: 0.18, crisis: 0.08 }
function withFill(c: Omit<Category, 'fill'>): Category { return { ...c, fill: TONE_FILL[c.tone] } }

// 1 ── Market Trend (is wealth being created or destroyed?) ─────────────
function scoreTrend(d: MarketsData): Omit<Category, 'fill'> {
  const px = d.spx[0]?.value ?? null
  const ma50 = sma(d.spx, 50), ma200 = sma(d.spx, 200)
  const dist200 = px != null && ma200 != null ? parseFloat(((px / ma200 - 1) * 100).toFixed(1)) : null
  const dd = drawdown(d.spx)
  const ma200Rising = d.spx.length > 210 ? (ma200 ?? 0) > (sma(d.spx.slice(20), 200) ?? 0) : true
  const signals: string[] = []
  if (dist200 != null) signals.push(`S&P 500 is ${dist200 >= 0 ? `${dist200}% above` : `${Math.abs(dist200)}% below`} its 200-day average — the line that separates bull from bear regimes`)
  if (dd != null) signals.push(dd <= -3 ? `Down ${Math.abs(dd)}% from its recent high` : 'Trading at or near recent highs')
  const ndd = drawdown(d.nasdaq)
  if (ndd != null) signals.push(`Nasdaq ${ndd <= -3 ? `${Math.abs(ndd)}% off its high` : 'near its high'}`)

  const aboveBoth = px != null && ma50 != null && ma200 != null && px > ma50 && px > ma200
  let status: string, tone: Tone
  if (px != null && ma200 != null && px < ma200 && dd != null && dd <= -10) { status = 'Downtrend'; tone = 'bad' }
  else if ((dd != null && dd <= -5) || (px != null && ma50 != null && px < ma50)) { status = 'Weakening'; tone = 'warn' }
  else if (aboveBoth && dd != null && dd > -3 && ma200Rising) { status = 'Strong Trend'; tone = 'good' }
  else if (px != null && ma200 != null && px > ma200) { status = 'Uptrend'; tone = 'good' }
  else { status = 'Stable'; tone = 'neutral' }

  const metrics: MetricCard[] = [
    { label: 'S&P 500', value: fNum(px), sub: dist200 != null ? `${dist200 >= 0 ? '+' : ''}${dist200}% vs 200d MA` : undefined, tone: toneLow(dd, -3, -10), points: spark(d.spx), ...hist(d.spx) },
    { label: 'Nasdaq Composite', value: fNum(d.nasdaq[0]?.value ?? null), sub: ndd != null ? `${ndd}% from high` : undefined, tone: toneLow(ndd, -3, -10), points: spark(d.nasdaq), ...hist(d.nasdaq) },
    { label: 'Trend Strength', value: aboveBoth ? 'Above 50 & 200d' : (px != null && ma200 != null && px > ma200) ? 'Above 200d only' : 'Below 200d MA', sub: 'price vs moving averages', tone: aboveBoth ? 'good' : (px != null && ma200 != null && px > ma200) ? 'neutral' : 'bad' },
    { label: 'Distance from 200d MA', value: dist200 != null ? `${dist200 >= 0 ? '+' : ''}${dist200}%` : '—', sub: 'bull/bear dividing line', tone: toneLow(dist200, 0, -5) },
  ]
  return { key: 'trend', label: 'Market Trend', status, tone, signals, metrics }
}

// 2 ── Risk Appetite (are investors embracing or avoiding risk?) ────────
function scoreRisk(d: MarketsData): Omit<Category, 'fill'> {
  const smallLarge = relPerf(d.rut, d.spx)   // small caps vs large caps, 3mo
  const cycDef = relPerf(d.cyc, d.def)        // cyclical vs defensive, 3mo
  const avg = [smallLarge, cycDef].filter((x): x is number => x != null)
  const score = avg.length ? parseFloat((avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1)) : null
  const signals: string[] = []
  if (smallLarge != null) signals.push(`Small caps ${smallLarge >= 0 ? 'outperforming' : 'lagging'} large caps by ${Math.abs(smallLarge)}pp over 3 months — ${smallLarge >= 0 ? 'a risk-on tell' : 'investors favoring safety/size'}`)
  if (cycDef != null) signals.push(`Cyclical stocks ${cycDef >= 0 ? 'leading' : 'trailing'} defensives by ${Math.abs(cycDef)}pp — ${cycDef >= 0 ? 'bets on growth' : 'rotation into safety'}`)

  let status: string, tone: Tone
  if (score != null && score <= -6) { status = 'Risk Avoidance'; tone = 'bad' }
  else if (score != null && score <= -2) { status = 'Defensive'; tone = 'warn' }
  else if (score != null && score < 2) { status = 'Balanced'; tone = 'neutral' }
  else if (score != null && score < 6) { status = 'Strong Appetite'; tone = 'good' }
  else { status = 'Risk Seeking'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'Small vs Large Caps', value: fRel(smallLarge), sub: '3mo, Russell 2000 − S&P', tone: toneLow(smallLarge, 0, -4) },
    { label: 'Cyclical vs Defensive', value: fRel(cycDef), sub: '3mo, discretionary − staples', tone: toneLow(cycDef, 0, -4) },
  ]
  return { key: 'risk', label: 'Risk Appetite', status, tone, signals, metrics }
}

// 3 ── Volatility & Fear (how fearful are investors?) ───────────────────
function scoreVolatility(d: MarketsData): Omit<Category, 'fill'> {
  const vix = d.vix[0]?.value ?? null
  const rv = realizedVol(d.spx)
  const vixMonthAgo = d.vix[21]?.value ?? null
  const vixChg = vix != null && vixMonthAgo != null ? parseFloat((vix - vixMonthAgo).toFixed(1)) : null
  const signals: string[] = []
  if (vix != null) signals.push(`VIX at ${vix.toFixed(1)} — ${vix >= 30 ? 'fear is elevated' : vix >= 20 ? 'investors are nervous' : 'markets are calm'}`)
  if (rv != null) signals.push(`Realized 1-month volatility running at ${fPct(rv)} annualized`)
  if (vixChg != null) signals.push(`VIX ${vixChg >= 0 ? `up ${vixChg}` : `down ${Math.abs(vixChg)}`} points over the past month`)

  let status: string, tone: Tone
  if (vix != null && vix >= 40) { status = 'Panic'; tone = 'crisis' }
  else if (vix != null && vix >= 30) { status = 'Fear Rising'; tone = 'bad' }
  else if (vix != null && vix >= 20) { status = 'Nervous'; tone = 'warn' }
  else if (vix != null && vix >= 18) { status = 'Elevated'; tone = 'neutral' }
  else { status = 'Calm'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'VIX', value: vix != null ? vix.toFixed(1) : '—', sub: 'the "fear gauge"', tone: toneHigh(vix, 20, 30, 40), points: spark(d.vix), ...hist(d.vix), ...alertAbove(vix, 30) },
    { label: 'Realized Volatility', value: fPct(rv), unit: '%', sub: 'annualized, 1mo', tone: toneHigh(rv, 18, 28) },
    { label: 'Volatility Trend', value: vixChg != null ? `${vixChg >= 0 ? '+' : ''}${vixChg.toFixed(1)}` : '—', sub: 'VIX 1-month change', tone: toneHigh(vixChg, 3, 8) },
  ]
  return { key: 'volatility', label: 'Volatility & Fear', status, tone, signals, metrics }
}

// 4 ── Market Participation (is everyone participating?) ─────────────────
// Proxied by equal-weight vs cap-weight relative performance — when the
// average stock lags the index, gains are concentrated in a few mega-caps.
function scoreParticipation(d: MarketsData): Omit<Category, 'fill'> {
  // Both windows measure the SAME thing — equal-weight vs cap-weight — so the
  // breadth read stays internally consistent (small-cap strength is a separate
  // risk-appetite signal and lives in that theme, not here).
  const ewVsCap = relPerf(d.rsp, d.spy)        // 3-month
  const ewVsCap1m = relPerf(d.rsp, d.spy, 21)  // 1-month
  const signals: string[] = []
  if (ewVsCap != null) signals.push(`The average S&P stock is ${ewVsCap >= 0 ? 'keeping pace with the index — broad participation' : `lagging the index by ${Math.abs(ewVsCap)}pp over 3 months — gains concentrated in a few mega-caps`}`)
  if (ewVsCap1m != null) signals.push(`Over the last month, breadth is ${ewVsCap1m >= 0 ? 'improving as more stocks join in' : 'still narrow as the average stock lags'}`)

  const lead = ewVsCap
  let status: string, tone: Tone
  if (lead != null && lead <= -6) { status = 'Deteriorating Participation'; tone = 'bad' }
  else if (lead != null && lead <= -2) { status = 'Narrow Leadership'; tone = 'warn' }
  else if (lead != null && lead < 1) { status = 'Stable'; tone = 'neutral' }
  else if (lead != null && lead < 4) { status = 'Healthy'; tone = 'good' }
  else { status = 'Broad Participation'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'Breadth (3-month)', value: fRel(ewVsCap), sub: 'RSP − SPY, equal vs cap weight', tone: toneLow(ewVsCap, 0, -4) },
    { label: 'Breadth (1-month)', value: fRel(ewVsCap1m), sub: 'recent breadth direction', tone: toneLow(ewVsCap1m, 0, -4) },
  ]
  return { key: 'participation', label: 'Market Participation', status, tone, signals, metrics }
}

// ── Overall status — the dominant signal from investor behavior ─────────
export type MarketsStatus = { emoji: string; label: string; tone: Tone }
const TONE_RANK: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3, crisis: 4 }
const TONE_EMOJI: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }
// Volatility/fear & trend carry the headline; participation/risk are subtler.
const PRIORITY = ['volatility', 'trend', 'participation', 'risk']

function pickWorst(cats: Category[]): Category {
  return [...cats].sort((a, b) => {
    const r = TONE_RANK[b.tone] - TONE_RANK[a.tone]
    return r !== 0 ? r : PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)
  })[0]
}

function overallStatus(cats: Category[]): MarketsStatus {
  const by: Record<string, Category> = Object.fromEntries(cats.map(c => [c.key, c]))
  const worst = pickWorst(cats)
  const tone = worst?.tone ?? 'good'
  const trend = by.trend
  let label: string
  if (tone === 'crisis') label = trend?.tone === 'bad' ? 'Disorderly Selling' : 'Panic Conditions'
  else if (tone === 'bad') label = worst.key === 'volatility' ? 'Risk Aversion' : worst.key === 'trend' ? 'Market Stress' : 'Capital Preservation Mode'
  else if (tone === 'warn') label = worst.key === 'participation' ? 'Narrow Leadership' : worst.key === 'risk' ? 'Defensive Positioning' : 'Risk Appetite Weakening'
  else if (tone === 'neutral') label = worst.key === 'risk' ? 'Selective Risk Taking' : worst.key === 'participation' ? 'Mixed Signals' : 'Neutral Positioning'
  else label = trend?.status === 'Strong Trend' ? 'Investor Confidence' : by.participation?.tone === 'good' && by.participation?.status === 'Broad Participation' ? 'Broad Participation' : 'Risk-On Environment'
  return { emoji: TONE_EMOJI[tone], label, tone }
}

// ── "What Investors Are Doing" — the human-readable takeaway ────────────
// Reflects actual risk BEHAVIOR (trend, risk appetite, volatility), not the
// structural breadth signal — investors can keep taking risk even when a rally
// is narrow, so a participation-driven headline shouldn't read as "defensive".
export type Doing = { tone: Tone; text: string }
function buildDoing(cats: Category[]): Doing {
  const behavioral = cats.filter(c => c.key !== 'participation')
  const tone = behavioral.reduce<Tone>((w, c) => TONE_RANK[c.tone] > TONE_RANK[w] ? c.tone : w, 'good')
  const text = tone === 'good' ? 'Investors Are Embracing Risk'
    : tone === 'neutral' ? 'Investors Are Becoming More Selective'
    : tone === 'warn' ? 'Investors Are Moving Defensive'
    : tone === 'bad' ? 'Investors Are Reducing Risk Exposure'
    : 'Investors Are Seeking Safety'
  return { tone, text }
}

// ── Alerts (separate from status) ───────────────────────────────────────
export type MarketAlert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }

function buildAlerts(d: MarketsData, cats: Category[]): MarketAlert[] {
  const alerts: MarketAlert[] = []
  const vix = d.vix[0]?.value ?? null
  const dd = drawdown(d.spx)
  const ewVsCap = relPerf(d.rsp, d.spy)

  if (dd != null && dd <= -20) {
    alerts.push({
      id: 'sp-bear', title: 'S&P 500 in Bear-Market Territory',
      what: `The S&P 500 is down ${Math.abs(dd)}% from its recent high.`,
      why: 'A drop of 20%+ marks a bear market — a sign investors are repricing growth and risk broadly, which tightens financial conditions and dents confidence across the economy.',
      affected: ['Investor Wealth', 'Business Investment', 'Consumer Spending', 'Economic Confidence'],
      context: 'Bear markets have accompanied most U.S. recessions, though not every bear market becomes one.',
    })
  } else if (dd != null && dd <= -10) {
    alerts.push({
      id: 'sp-correction', title: 'S&P 500 in Correction Territory',
      what: `The S&P 500 is down ${Math.abs(dd)}% from its recent high.`,
      why: 'A 10%+ pullback signals investors are growing cautious and trimming risk — it can dent confidence and spending even if it doesn’t deepen into a bear market.',
      affected: ['Investor Wealth', 'Economic Confidence', 'Consumer Spending'],
      context: 'Corrections are common (roughly one a year on average) and most do not turn into bear markets.',
    })
  }

  if (vix != null && vix >= 40) {
    alerts.push({
      id: 'vix-40', title: 'VIX Above 40 — Panic Conditions',
      what: `The VIX is at ${vix.toFixed(1)}.`,
      why: 'A VIX above 40 reflects extreme fear and disorderly trading — investors are paying up heavily for protection and risk assets are being dumped.',
      affected: ['Investor Wealth', 'Credit', 'Business Investment', 'Economic Confidence'],
      context: 'VIX above 40 has only occurred during acute crises — 2008, 2011, 2020.',
    })
  } else if (vix != null && vix >= 30) {
    alerts.push({
      id: 'vix-30', title: 'VIX Above 30 — Elevated Fear',
      what: `The VIX is at ${vix.toFixed(1)}.`,
      why: 'A VIX above 30 signals investors are anxious and bracing for larger swings — risk appetite tends to retreat sharply at these levels.',
      affected: ['Investor Wealth', 'Credit', 'Economic Confidence'],
      context: 'A VIX above 30 typically marks periods of meaningful market stress.',
    })
  }

  // Sharp short-term move — a velocity signal, independent of the slow
  // drawdown-from-high alerts above. Tiers escalate in place (panic supersedes).
  const day = d.spx.length > 1 && d.spx[1].value !== 0 ? parseFloat(((d.spx[0].value / d.spx[1].value - 1) * 100).toFixed(1)) : null
  const week = d.spx.length > 5 && d.spx[5].value !== 0 ? parseFloat(((d.spx[0].value / d.spx[5].value - 1) * 100).toFixed(1)) : null
  const move = day != null && day <= -2.5
    ? `The S&P 500 fell ${Math.abs(day)}% in a single day${week != null && week <= -2 ? ` (${Math.abs(week)}% over the week)` : ''}.`
    : week != null ? `The S&P 500 is down ${Math.abs(week)}% over the past week.` : ''
  if ((day != null && day <= -4.5) || (week != null && week <= -7)) {
    alerts.push({
      id: 'market-selloff', title: 'Sharp Market Sell-Off — Panic Selling',
      what: move,
      why: 'A drop this fast signals investors are rushing for the exits — a sudden repricing of risk that can feed on itself, freeze risk-taking, and spill into credit and confidence.',
      affected: ['Investor Wealth', 'Credit', 'Economic Confidence'],
      context: 'Single-day drops of 4%+ are rare outside genuine stress episodes (2008, 2020).',
    })
  } else if ((day != null && day <= -2.5) || (week != null && week <= -5)) {
    alerts.push({
      id: 'market-selloff', title: 'Sharp Market Sell-Off — Investors on Edge',
      what: move,
      why: 'A fast pullback like this gets investors’ attention — it reflects rising nervousness and can be an early sign sentiment is turning, even if the broader trend is still intact.',
      affected: ['Investor Wealth', 'Economic Confidence'],
      context: 'Sharp 2–3% single-day drops happen a few times a year; most fade, but they mark moments of heightened anxiety.',
    })
  }

  if (ewVsCap != null && ewVsCap <= -6) {
    alerts.push({
      id: 'breadth-weak', title: 'Market Breadth Deteriorating',
      what: `The average S&P stock is lagging the index by ${Math.abs(ewVsCap)}pp over 3 months.`,
      why: 'When gains depend on a handful of mega-caps while most stocks lag, the rally is fragile — a stumble in the leaders can drag the whole index down.',
      affected: ['Investor Wealth', 'Economic Confidence'],
      context: 'Narrowing breadth preceded the 2000 and 2007 market peaks.',
    })
  }

  return alerts
}

// ── Watching closely (never empty) ─────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number; key: string }

function buildWatching(d: MarketsData, alerts: MarketAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []
  const vix = d.vix[0]?.value ?? null
  const dd = drawdown(d.spx)
  const ewVsCap = relPerf(d.rsp, d.spy)

  if (vix != null && !firing.has('vix-30') && !firing.has('vix-40')) {
    items.push({ label: 'VIX', text: `${(30 - vix).toFixed(1)} points from the 30 alert threshold`, proximity: Math.max(0, Math.min(1, vix / 30)), key: 'volatility' })
  }
  if (dd != null && !firing.has('sp-correction') && !firing.has('sp-bear')) {
    items.push({ label: 'S&P 500', text: `${(Math.abs(-10 - dd)).toFixed(1)}% from correction territory`, proximity: Math.max(0, Math.min(1, Math.abs(dd) / 10)), key: 'trend' })
  }
  if (ewVsCap != null && !firing.has('breadth-weak')) {
    items.push({ label: 'Market Breadth', text: ewVsCap <= -2 ? 'in the narrow-leadership warning zone' : `${(ewVsCap + 6).toFixed(1)}pp from the breadth warning`, proximity: Math.max(0, Math.min(1, (-ewVsCap + 2) / 8)), key: 'participation' })
  }
  return items.sort((a, b) => b.proximity - a.proximity).slice(0, 5)
}

// ── Biggest risk / biggest stabilizer ──────────────────────────────────
const RISK_PHRASE: Record<string, string> = {
  'volatility:Panic': 'Volatility has spiked to panic levels as investors dump risk.',
  'volatility:Fear Rising': 'Fear is rising fast — the VIX has jumped above 30.',
  'volatility:Nervous': 'Investor nerves are building as volatility climbs.',
  'trend:Downtrend': 'The market has rolled over below its long-term trend.',
  'trend:Weakening': 'The uptrend is weakening as prices slip below shorter-term averages.',
  'participation:Deteriorating Participation': 'Market gains are increasingly carried by just a few mega-caps.',
  'participation:Narrow Leadership': 'Market gains continue to narrow as fewer stocks participate in the rally.',
  'risk:Risk Avoidance': 'Investors are fleeing risk, favoring safety and size.',
  'risk:Defensive': 'Investors are rotating defensively, out of cyclicals and small caps.',
}
const STAB_PHRASE: Record<string, string> = {
  'volatility:Calm': 'Volatility remains low and investor sentiment remains constructive.',
  'volatility:Elevated': 'Volatility is contained despite some nerves.',
  'trend:Strong Trend': 'The market trend remains firmly higher, supported by broad gains.',
  'trend:Uptrend': 'The market remains in an uptrend above its key averages.',
  'participation:Broad Participation': 'Market strength is broad — most stocks are participating.',
  'participation:Healthy': 'Participation is healthy across the market.',
  'risk:Risk Seeking': 'Investors are leaning into risk, a sign of confidence.',
  'risk:Strong Appetite': 'Risk appetite remains healthy.',
}
const STAB_PREF = ['volatility', 'trend', 'participation', 'risk']

const RISK_WHY: Record<string, string> = {
  trend: 'When the broad market rolls over, household wealth shrinks and confidence fades — people and businesses pull back on spending and investment.',
  risk: 'When investors retreat from risk, money flows out of growth bets and into safety — a sign confidence in the expansion is fading.',
  volatility: 'Spiking volatility means investors are scared and bracing for big swings — fear feeds on itself and can trigger forced selling.',
  participation: 'When only a few giant stocks hold the index up, the rally is fragile — a stumble in those leaders can pull the whole market down.',
}
const STAB_WHY: Record<string, string> = {
  trend: 'A market trending higher builds wealth and confidence, supporting spending and investment.',
  risk: 'Investors willing to own risk is a vote of confidence in the economy ahead.',
  volatility: 'Low volatility means investors are calm — the backdrop for orderly, sustained gains.',
  participation: 'Broad participation means the rally rests on many stocks, not a fragile few.',
}

export type Callout = { text: string; why: string; key: string }

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: Callout; stabilizer: Callout } {
  const worst = pickWorst(cats)
  const useWatch = !(worst && TONE_RANK[worst.tone] >= 2)
  const riskText = !useWatch
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label}: ${worst.status.toLowerCase()}.`)
    : watching[0] ? `${watching[0].label} approaching its alert — ${watching[0].text}.` : 'No major market risks building right now.'
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

function buildLastAlert(d: MarketsData): string | null {
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  // Most recent day the VIX closed above 30.
  const spike = d.vix.find(o => o.value >= 30)
  if (spike) return `VIX last exceeded 30 on ${fmtDate(spike.date)}.`
  // Otherwise the VIX peak in the window — a real, dated reference.
  if (d.vix.length) {
    let peak = d.vix[0]
    for (const o of d.vix) if (o.value > peak.value) peak = o
    return `Markets calm — the VIX peaked at ${peak.value.toFixed(1)} on ${fmtDate(peak.date)} and has settled since.`
  }
  return null
}

// ── Summary generator (75–125 words, deterministic) ─────────────────────
function buildSummary(d: MarketsData, cats: Category[], risk: Callout): string {
  const by: Record<string, Category> = Object.fromEntries(cats.map(c => [c.key, c]))
  const trend = by.trend, vol = by.volatility, part = by.participation, rsk = by.risk
  const dd = drawdown(d.spx)

  const s1 = rsk?.tone === 'good' || rsk?.tone === 'neutral'
    ? 'Investors remain willing to take risk despite a mixed economic backdrop.'
    : 'Investors are pulling back from risk as caution takes hold.'
  const s2 = trend?.tone === 'good'
    ? `Major equity indices continue to trend higher${vol?.tone === 'good' ? ' while volatility remains contained' : ''}.`
    : trend?.tone === 'bad'
    ? `Major indices have rolled over${dd != null ? `, with the S&P ${Math.abs(dd)}% off its high` : ''}.`
    : 'Major indices are trading sideways as the trend loses momentum.'
  const s3 = part?.tone === 'good'
    ? 'Market participation remains healthy, with gains spread across many stocks.'
    : 'Gains have become increasingly concentrated in a smaller group of companies, leaving breadth thin.'
  const s4 = vol?.tone === 'good' ? 'Volatility remains low, a sign of underlying calm.'
    : vol?.tone === 'crisis' || vol?.tone === 'bad' ? 'Volatility has spiked as fear takes over.'
    : 'Volatility is creeping up as nerves build.'
  // What it means next — tie the threads together for the reader.
  const s5 = part?.tone === 'warn' || part?.tone === 'bad'
    ? 'For now risk appetite is holding up, but thin breadth leaves the rally vulnerable if the handful of leaders stumble.'
    : trend?.tone === 'bad' || vol?.tone === 'bad' || vol?.tone === 'crisis'
    ? 'If fear keeps building, the pullback could deepen as investors move to protect capital.'
    : 'With volatility contained and participation broad, the path of least resistance remains higher.'
  const s6 = `The primary risk: ${/^[A-Z][A-Z.]/.test(risk.text) ? risk.text : risk.text.charAt(0).toLowerCase() + risk.text.slice(1)}`
  return [s1, s2, s3, s4, s5, s6].filter(Boolean).join(' ')
}

// ── Public entry point ──────────────────────────────────────────────────
export type MarketsModel = {
  available: boolean
  status: MarketsStatus
  subtitle: string
  summary: string
  doing: Doing
  risk: Callout
  stabilizer: Callout
  categories: Category[]
  alerts: MarketAlert[]
  lastAlert: string | null
  watching: WatchItem[]
}

const SUBTITLES: Record<string, string> = {
  'Risk-On Environment': 'Investors are confidently taking on risk.',
  'Investor Confidence': 'Confidence is high and the trend is strong.',
  'Broad Participation': 'The rally is broad — most stocks are joining in.',
  'Neutral Positioning': 'Investors are neither aggressive nor fearful.',
  'Selective Risk Taking': 'Risk is being taken selectively, not broadly.',
  'Mixed Signals': 'The market is sending conflicting signals.',
  'Risk Appetite Weakening': 'Appetite for risk is starting to fade.',
  'Defensive Positioning': 'Investors are rotating toward safety.',
  'Narrow Leadership': 'A handful of stocks are carrying the market.',
  'Market Stress': 'The market is under real stress.',
  'Risk Aversion': 'Investors are actively avoiding risk.',
  'Capital Preservation Mode': 'The priority has shifted to protecting capital.',
  'Market Warning': 'Severe market stress is emerging.',
  'Panic Conditions': 'Fear has reached panic levels.',
  'Disorderly Selling': 'Selling has turned disorderly.',
  'Data Unavailable': 'Live market data is temporarily unavailable.',
}

export async function buildMarketsModel(): Promise<MarketsModel> {
  const data = await fetchMarketsData()

  // S&P 500 is the keystone — if it's missing, don't fabricate a status.
  if (data.spx[0]?.value == null) {
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      summary: 'Live market data is temporarily unavailable. Check back shortly.',
      doing: { tone: 'neutral', text: 'Data unavailable' },
      risk: { text: '', why: '', key: '' }, stabilizer: { text: '', why: '', key: '' },
      categories: [], alerts: [], lastAlert: null, watching: [],
    }
  }

  const categories = [scoreTrend(data), scoreRisk(data), scoreVolatility(data), scoreParticipation(data)].map(withFill)
  const status = overallStatus(categories)
  const alerts = buildAlerts(data, categories)
  const watching = buildWatching(data, alerts)
  const { risk, stabilizer } = riskAndStabilizer(categories, watching)

  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    summary: buildSummary(data, categories, risk),
    doing: buildDoing(categories),
    risk, stabilizer, categories, alerts,
    lastAlert: buildLastAlert(data),
    watching,
  }
}
