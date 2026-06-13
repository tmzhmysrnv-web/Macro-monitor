// lib/global.ts
// Global-risk intelligence model. Answers one question: "are global forces
// creating new risks for the economy?". Four themes — Capital Flows, Energy &
// Commodities, Global Growth, Global Financial Stress — scored on objective
// market data; the overall status reflects the dominant EXTERNAL risk signal.
//
// Data: Yahoo Finance daily history (no key) + one FRED series (10Y yield).
// Per the spec's data philosophy, this tracks the measurable economic
// consequences of global events, not geopolitics directly. Metric notes —
// foreign Treasury holdings / auction participation have no free real-time
// source, so capital flows are read via the dollar (DXY) + 10Y safe-haven
// demand; EM stress is read via EM equities (EEM) rather than paid CDS data.

import { toneHigh, toneLow, type Tone as MetricTone } from './metricTone'

export type Obs = { date: string; value: number }

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
function ret(obs: Obs[], n: number): number | null {
  if (obs.length <= n || obs[n].value === 0) return null
  return parseFloat(((obs[0].value / obs[n].value - 1) * 100).toFixed(1))
}
function relPerf(a: Obs[], b: Obs[], n = 63): number | null {
  const ra = ret(a, n), rb = ret(b, n)
  if (ra == null || rb == null) return null
  return parseFloat((ra - rb).toFixed(1))
}
function drawdown(obs: Obs[]): number | null {
  if (obs.length < 2) return null
  const peak = Math.max(...obs.map(o => o.value))
  return parseFloat(((obs[0].value / peak - 1) * 100).toFixed(1))
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
  return { alertText: `${(threshold - value).toFixed(unit === '%' ? 2 : 0)}${unit} from ${threshold}${unit} alert`, alertProximity: Math.max(0, Math.min(1, value / threshold)) }
}

const fUsd = (v: number | null, d = 0) => v == null ? '—' : `$${v.toFixed(d)}`
const fRel = (v: number | null) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`
const fSigned = (v: number | null, suffix = '%') => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}${suffix}`

export type GlobalData = {
  dxy: Obs[]
  wti: Obs[]; brent: Obs[]; commodity: Obs[]
  copper: Obs[]; gold: Obs[]; acwx: Obs[]
  eem: Obs[]
}

export async function fetchGlobalData(): Promise<GlobalData> {
  const [dxy, wti, brent, commodity, copper, gold, acwx, eem] = await Promise.all([
    yahooHistory('DX-Y.NYB'), // US dollar index
    yahooHistory('CL=F'),     // WTI crude
    yahooHistory('BZ=F'),     // Brent crude
    yahooHistory('DBC'),      // broad commodity index
    yahooHistory('HG=F'),     // copper
    yahooHistory('GC=F'),     // gold (safe-haven demand + copper/gold growth-vs-fear ratio)
    yahooHistory('ACWX'),     // global equities ex-US
    yahooHistory('EEM'),      // emerging-market equities
  ])
  return { dxy, wti, brent, commodity, copper, gold, acwx, eem }
}

// ── Category scoring ──────────────────────────────────────────────────
export type Tone = 'good' | 'neutral' | 'warn' | 'bad' | 'crisis'
export type Category = {
  key: string; label: string; status: string; tone: Tone; fill: number
  signals: string[]; metrics: MetricCard[]
}
const TONE_FILL: Record<Tone, number> = { good: 0.9, neutral: 0.55, warn: 0.4, bad: 0.18, crisis: 0.08 }
function withFill(c: Omit<Category, 'fill'>): Category { return { ...c, fill: TONE_FILL[c.tone] } }
const RANK: Record<Tone, number> = { good: 0, neutral: 1, warn: 2, bad: 3, crisis: 4 }

// 1 ── Global Capital Flows (where is global capital moving?) ───────────
function scoreCapital(d: GlobalData): Omit<Category, 'fill'> {
  // Dollar + safe-haven gold = where global capital is moving. (The Treasury
  // demand / term-premium angle lives on the Bonds tab, where it belongs.)
  const dxy = d.dxy[0]?.value ?? null
  const dxy3m = ret(d.dxy, 63)
  const gold = d.gold[0]?.value ?? null
  const gold3m = ret(d.gold, 63)
  const signals: string[] = []
  if (dxy != null) signals.push(`The dollar is at ${dxy.toFixed(1)}${dxy3m != null ? ` (${dxy3m >= 0 ? '+' : ''}${dxy3m}% over 3 months)` : ''} — ${dxy3m != null && dxy3m >= 3 ? 'a fast climb that strains foreign borrowers' : 'broadly stable'}`)
  if (gold3m != null) signals.push(`Gold ${gold3m >= 0 ? `up ${gold3m}%` : `down ${Math.abs(gold3m)}%`} over 3 months — ${gold3m >= 12 ? 'heavy safe-haven demand' : 'no rush to safety'}`)

  let status: string, tone: Tone
  if (dxy3m != null && dxy3m >= 6) { status = 'Global Stress'; tone = 'bad' }
  else if (dxy3m != null && dxy3m >= 3) { status = 'Flight to Safety'; tone = 'warn' }
  else if (dxy3m != null && dxy3m <= -3) { status = 'Strong Global Confidence'; tone = 'good' }
  else if (dxy3m != null && dxy3m >= 1) { status = 'Stable'; tone = 'neutral' }
  else { status = 'Normal Flows'; tone = 'good' }
  // A simultaneous dollar + gold surge is a genuine flight to safety.
  if (dxy3m != null && dxy3m >= 2 && gold3m != null && gold3m >= 15 && RANK[tone] < RANK.warn) { status = 'Flight to Safety'; tone = 'warn' }

  const metrics: MetricCard[] = [
    { label: 'U.S. Dollar (DXY)', value: dxy != null ? dxy.toFixed(2) : '—', sub: dxy3m != null ? `${dxy3m >= 0 ? '+' : ''}${dxy3m}% 3mo` : undefined, tone: toneHigh(dxy3m, 3, 6), points: spark(d.dxy), ...hist(d.dxy) },
    { label: 'Gold (Safe Haven)', value: gold != null ? `$${Math.round(gold)}` : '—', sub: gold3m != null ? `${gold3m >= 0 ? '+' : ''}${gold3m}% 3mo` : undefined, tone: toneHigh(gold3m, 12, 22), points: spark(d.gold), ...hist(d.gold) },
  ]
  return { key: 'capital', label: 'Global Capital Flows', status, tone, signals, metrics }
}

// 2 ── Energy & Commodity Pressure (external inflation/supply risk) ──────
function scoreEnergy(d: GlobalData): Omit<Category, 'fill'> {
  const wti = d.wti[0]?.value ?? null
  const brent = d.brent[0]?.value ?? null
  const com3m = ret(d.commodity, 63)
  const signals: string[] = []
  if (wti != null) signals.push(`WTI crude at ${fUsd(wti)}${brent != null ? `, Brent at ${fUsd(brent)}` : ''} — ${wti >= 88 ? 'energy costs are a live inflation risk' : 'energy prices are contained'}`)
  if (com3m != null) signals.push(`Broad commodities ${com3m >= 0 ? `up ${com3m}%` : `down ${Math.abs(com3m)}%`} over 3 months${com3m >= 10 ? ' — supply pressure building' : ''}`)

  let status: string, tone: Tone
  if ((wti != null && wti >= 130) || (com3m != null && com3m >= 30)) { status = 'Commodity Stress Event'; tone = 'crisis' }
  else if ((wti != null && wti >= 110) || (com3m != null && com3m >= 20)) { status = 'Shock Risk'; tone = 'bad' }
  else if ((wti != null && wti >= 88) || (com3m != null && com3m >= 10)) { status = 'Rising Pressure'; tone = 'warn' }
  else if (wti != null && wti >= 65) { status = 'Normal'; tone = 'neutral' }
  else { status = 'Low Pressure'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'WTI Crude', value: fUsd(wti), tone: toneHigh(wti, 88, 110, 130), points: spark(d.wti), ...hist(d.wti), ...alertAbove(wti, 100) },
    { label: 'Brent Crude', value: fUsd(brent), tone: toneHigh(brent, 92, 114, 134), points: spark(d.brent), ...hist(d.brent) },
    { label: 'Commodity Momentum', value: fSigned(com3m), sub: '3mo, broad index (DBC)', tone: toneHigh(com3m, 10, 20), points: spark(d.commodity) },
  ]
  return { key: 'energy', label: 'Energy & Commodity Pressure', status, tone, signals, metrics }
}

// 3 ── Global Growth Conditions (is the world strengthening?) ───────────
function scoreGrowth(d: GlobalData): Omit<Category, 'fill'> {
  const copper = d.copper[0]?.value ?? null
  const copper3m = ret(d.copper, 63)
  const copperGold = relPerf(d.copper, d.gold, 63) // growth vs fear
  const acwxDD = drawdown(d.acwx)
  const signals: string[] = []
  if (copper3m != null) signals.push(`Copper — the classic global-growth barometer — is ${copper3m >= 0 ? `up ${copper3m}%` : `down ${Math.abs(copper3m)}%`} over 3 months`)
  if (copperGold != null) signals.push(`Copper is ${copperGold >= 0 ? 'outpacing' : 'lagging'} gold by ${Math.abs(copperGold)}pp — ${copperGold >= 0 ? 'growth optimism over safe-haven demand' : 'investors favoring safety over growth'}`)
  if (acwxDD != null) signals.push(`Global ex-US equities ${acwxDD <= -3 ? `${Math.abs(acwxDD)}% off their high` : 'near their highs'}`)

  let status: string, tone: Tone
  if ((copper3m != null && copper3m <= -20) || (acwxDD != null && acwxDD <= -20)) { status = 'Global Contraction Risk'; tone = 'crisis' }
  else if ((copper3m != null && copper3m <= -12) || (acwxDD != null && acwxDD <= -15)) { status = 'Weakening'; tone = 'bad' }
  else if ((copper3m != null && copper3m <= -5) || (copperGold != null && copperGold <= -8)) { status = 'Slowing'; tone = 'warn' }
  else if (copper3m != null && copper3m >= 8) { status = 'Expanding'; tone = 'good' }
  else if (copper3m != null && copper3m >= 2) { status = 'Healthy Growth'; tone = 'good' }
  else { status = 'Stable'; tone = 'neutral' }

  const metrics: MetricCard[] = [
    { label: 'Copper', value: copper != null ? `$${copper.toFixed(2)}` : '—', sub: copper3m != null ? `${copper3m >= 0 ? '+' : ''}${copper3m}% 3mo` : undefined, tone: toneLow(copper3m, 0, -8), points: spark(d.copper), ...hist(d.copper) },
    { label: 'Copper / Gold', value: fRel(copperGold), sub: '3mo, growth vs fear', tone: toneLow(copperGold, 0, -8) },
    { label: 'Global Equities', value: acwxDD != null ? `${acwxDD}%` : '—', sub: 'ex-US, from 1y high', tone: toneLow(acwxDD, -3, -10), points: spark(d.acwx), ...hist(d.acwx) },
  ]
  return { key: 'growth', label: 'Global Growth Conditions', status, tone, signals, metrics }
}

// 4 ── Global Financial Stress (is stress spreading abroad?) ────────────
function scoreFinancial(d: GlobalData): Omit<Category, 'fill'> {
  const eemDD = drawdown(d.eem)
  const emRel = relPerf(d.eem, d.acwx, 63) // EM vs global
  const eem3m = ret(d.eem, 63)
  const signals: string[] = []
  if (eemDD != null) signals.push(`Emerging-market equities are ${eemDD <= -3 ? `${Math.abs(eemDD)}% off their high` : 'near their highs'} — ${eemDD <= -15 ? 'a sign of real stress abroad' : 'no broad EM distress'}`)
  if (emRel != null) signals.push(`EM is ${emRel >= 0 ? 'keeping pace with' : `lagging the rest of the world by ${Math.abs(emRel)}pp over 3 months —`} ${emRel >= 0 ? 'no relative flight from EM' : 'capital rotating out of riskier markets'}`)

  let status: string, tone: Tone
  if (eemDD != null && eemDD <= -25) { status = 'Contagion Risk'; tone = 'crisis' }
  else if ((eemDD != null && eemDD <= -15) || (emRel != null && emRel <= -8)) { status = 'Financial Risk'; tone = 'bad' }
  else if ((eemDD != null && eemDD <= -10) || (emRel != null && emRel <= -4)) { status = 'Stress Building'; tone = 'warn' }
  else if (eemDD != null && eemDD <= -5) { status = 'Elevated'; tone = 'neutral' }
  else { status = 'Stable'; tone = 'good' }

  const metrics: MetricCard[] = [
    { label: 'EM Equities', value: eemDD != null ? `${eemDD}%` : '—', sub: eem3m != null ? `${eem3m >= 0 ? '+' : ''}${eem3m}% 3mo · from high` : 'from 1y high', tone: toneLow(eemDD, -5, -15), points: spark(d.eem), ...hist(d.eem) },
    { label: 'EM vs Global', value: fRel(emRel), sub: '3mo, EM − world equities', tone: toneLow(emRel, 0, -5) },
  ]
  return { key: 'financial', label: 'Global Financial Stress', status, tone, signals, metrics }
}

// ── Overall status — the dominant external risk ─────────────────────────
export type GlobalStatus = { emoji: string; label: string; tone: Tone }
const TONE_EMOJI: Record<Tone, string> = { good: '🟢', neutral: '🟡', warn: '🟠', bad: '🔴', crisis: '🚨' }
// Capital flows & financial stress are the most systemic (contagion channels).
const PRIORITY = ['financial', 'capital', 'growth', 'energy']

function pickWorst(cats: Category[]): Category {
  return [...cats].sort((a, b) => {
    const r = RANK[b.tone] - RANK[a.tone]
    return r !== 0 ? r : PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key)
  })[0]
}

function overallStatus(cats: Category[]): GlobalStatus {
  const worst = pickWorst(cats)
  const elevated = cats.filter(c => RANK[c.tone] >= 2).length      // warn+ themes
  const neutralCount = cats.filter(c => c.tone === 'neutral').length
  // A lone benign 'neutral' among healthy themes is NOT a yellow warning — the
  // watchlist (🟡) tier needs a genuine mix (2+ neutral) or an actual warn+.
  const tone: Tone = elevated > 0 ? worst.tone : neutralCount >= 2 ? 'neutral' : 'good'
  let label: string
  if (tone === 'crisis') label = worst.key === 'financial' ? 'Systemic Global Risk' : worst.key === 'energy' ? 'Major External Shock' : 'Global Warning'
  else if (tone === 'bad') label = worst.key === 'capital' ? 'Significant External Risk' : worst.key === 'financial' ? 'International Disruption Risk' : 'Global Stress'
  else if (tone === 'warn') label = elevated >= 2 ? 'Multiple Risk Signals' : worst.key === 'capital' ? 'Global Pressure Building' : 'Rising Global Stress'
  else if (tone === 'neutral') label = elevated >= 1 ? 'External Pressures Building' : 'Mixed Global Signals'
  else label = 'Global Stability'
  return { emoji: TONE_EMOJI[tone], label, tone }
}

// ── "What The World Is Experiencing" — the human-readable takeaway ──────
export type Experiencing = { tone: Tone; text: string }
function buildExperiencing(tone: Tone): Experiencing {
  const text = tone === 'good' ? 'Broad Global Stability'
    : tone === 'neutral' ? 'Growing External Pressures'
    : tone === 'warn' ? 'Multiple Areas of Concern'
    : tone === 'bad' ? 'Elevated Global Stress'
    : 'Significant Global Disruption'
  return { tone, text }
}

// ── Alerts (separate from status) ───────────────────────────────────────
export type GlobalAlert = { id: string; title: string; what: string; why: string; affected: string[]; context: string }

function buildAlerts(d: GlobalData): GlobalAlert[] {
  const alerts: GlobalAlert[] = []
  const dxy = d.dxy[0]?.value ?? null
  const dxy3m = ret(d.dxy, 63)
  const wti = d.wti[0]?.value ?? null
  const copper3m = ret(d.copper, 63)
  const eemDD = drawdown(d.eem)

  if (dxy3m != null && dxy3m >= 6) {
    alerts.push({
      id: 'dxy-stress', title: 'Dollar Strength in the Stress Zone',
      what: `The dollar index has surged ${dxy3m}% in three months${dxy != null ? ` to ${dxy.toFixed(1)}` : ''}.`,
      why: 'A rapidly strengthening dollar makes dollar-denominated debt more expensive for foreign borrowers and drains liquidity from emerging markets — a classic trigger of overseas financial stress that can rebound on U.S. exporters and markets.',
      affected: ['Markets', 'Credit', 'Inflation', 'Government Finance'],
      context: 'Sharp dollar spikes preceded the 1997 Asian crisis and the 2022 global tightening scare.',
    })
  } else if (dxy != null && dxy >= 107) {
    alerts.push({
      id: 'dxy-warn', title: 'Dollar Entering Warning Territory',
      what: `The dollar index is at ${dxy.toFixed(1)}.`,
      why: 'An elevated dollar tightens global financial conditions and pressures foreign borrowers, even before it becomes a full stress event.',
      affected: ['Markets', 'Credit', 'Inflation'],
      context: 'A persistently strong dollar has historically squeezed emerging-market growth.',
    })
  }

  if (wti != null && wti >= 120) {
    alerts.push({
      id: 'oil-shock', title: 'Oil Supply Shock — WTI Above $120',
      what: `WTI crude is trading at ${fUsd(wti)}.`,
      why: 'Oil above $120 acts as a tax on the global economy — it lifts inflation, squeezes consumer spending, and has historically tipped economies toward recession.',
      affected: ['Inflation', 'Consumer Spending', 'Markets', 'Labor'],
      context: 'Oil shocks contributed to the recessions of 1973, 1990, and 2008.',
    })
  } else if (wti != null && wti >= 100) {
    alerts.push({
      id: 'oil-100', title: 'WTI Crude Above $100',
      what: `WTI crude is trading at ${fUsd(wti)}.`,
      why: 'Oil above $100 flows quickly into gasoline and shipping costs, raising inflation and denting growth worldwide.',
      affected: ['Inflation', 'Consumer Spending', 'Markets'],
      context: 'Sustained oil above $100 accompanied the inflation surges of 2008 and 2022.',
    })
  }

  if (copper3m != null && copper3m <= -12) {
    alerts.push({
      id: 'copper-slump', title: 'Global Growth Warning — Copper Slumping',
      what: `Copper has fallen ${Math.abs(copper3m)}% over three months.`,
      why: 'Copper is used across construction and manufacturing worldwide, so a sharp drop signals fading global industrial demand — an early sign the world economy is slowing.',
      affected: ['Markets', 'Labor', 'Consumer Spending'],
      context: 'Falling copper led the global slowdowns of 2015 and 2008.',
    })
  }

  if (eemDD != null && eemDD <= -15) {
    alerts.push({
      id: 'em-stress', title: 'Emerging-Market Stress Building',
      what: `Emerging-market equities are ${Math.abs(eemDD)}% below their recent high.`,
      why: 'A deep EM drawdown signals capital fleeing riskier economies — stress that can spread through trade links, banks, and currency markets into developed markets.',
      affected: ['Markets', 'Credit', 'Government Finance'],
      context: 'EM sell-offs preceded broader contagion in 1997–98 and 2008.',
    })
  }

  return alerts
}

// ── Watching closely (never empty) ─────────────────────────────────────
export type WatchItem = { label: string; text: string; proximity: number; key: string }

function buildWatching(d: GlobalData, alerts: GlobalAlert[]): WatchItem[] {
  const firing = new Set(alerts.map(a => a.id))
  const items: WatchItem[] = []
  const dxy = d.dxy[0]?.value ?? null
  const wti = d.wti[0]?.value ?? null
  const copper3m = ret(d.copper, 63)
  const eemDD = drawdown(d.eem)

  if (dxy != null && !firing.has('dxy-warn') && !firing.has('dxy-stress')) {
    items.push({ label: 'U.S. Dollar (DXY)', text: `${(107 - dxy).toFixed(1)} from the 107 warning level`, proximity: Math.max(0, Math.min(1, dxy / 107)), key: 'capital' })
  }
  if (wti != null && !firing.has('oil-100') && !firing.has('oil-shock')) {
    items.push({ label: 'WTI Crude', text: `${fUsd(100 - wti)} from the $100 alert level`, proximity: Math.max(0, Math.min(1, wti / 100)), key: 'energy' })
  }
  if (copper3m != null && !firing.has('copper-slump')) {
    items.push({ label: 'Copper', text: copper3m <= -5 ? 'in the slowdown zone' : `${(copper3m + 12).toFixed(0)}pp from the slowdown trigger`, proximity: Math.max(0, Math.min(1, (-copper3m + 5) / 17)), key: 'growth' })
  }
  if (eemDD != null && !firing.has('em-stress')) {
    items.push({ label: 'EM Equities', text: `${(Math.abs(-15 - eemDD)).toFixed(0)}% from the stress threshold`, proximity: Math.max(0, Math.min(1, Math.abs(eemDD) / 15)), key: 'financial' })
  }
  return items.sort((a, b) => b.proximity - a.proximity).slice(0, 5)
}

// ── Biggest risk / biggest stabilizer ──────────────────────────────────
const RISK_PHRASE: Record<string, string> = {
  'capital:Global Stress': 'A surging dollar is draining liquidity from global markets.',
  'capital:Flight to Safety': 'A strengthening dollar is increasing pressure on global borrowers and emerging markets.',
  'energy:Commodity Stress Event': 'A commodity price shock is hitting the global economy.',
  'energy:Shock Risk': 'Surging energy prices threaten to lift inflation and slow global growth.',
  'energy:Rising Pressure': 'Rising energy and commodity prices are adding external inflation pressure.',
  'growth:Global Contraction Risk': 'Global industrial demand is contracting sharply.',
  'growth:Weakening': 'Global growth is weakening as copper and world equities slide.',
  'growth:Slowing': 'Global growth momentum is fading.',
  'financial:Contagion Risk': 'Emerging-market stress is at risk of spreading globally.',
  'financial:Financial Risk': 'Financial stress is building across emerging markets.',
  'financial:Stress Building': 'Cracks are forming in emerging-market finances.',
}
const STAB_PHRASE: Record<string, string> = {
  'capital:Normal Flows': 'Foreign demand for U.S. Treasuries remains healthy and the dollar is stable.',
  'capital:Strong Global Confidence': 'A softening dollar reflects confident, risk-on global capital flows.',
  'energy:Low Pressure': 'Low, stable energy prices are keeping external inflation pressure off.',
  'energy:Normal': 'Energy and commodity prices are well-behaved.',
  'growth:Expanding': 'Global growth is accelerating — copper and world equities are firm.',
  'growth:Healthy Growth': 'Global growth conditions remain healthy.',
  'financial:Stable': 'Financial contagion risks remain limited and emerging markets are calm.',
}
const STAB_PREF = ['financial', 'capital', 'growth', 'energy']

const RISK_WHY: Record<string, string> = {
  capital: 'A strong dollar makes the world’s dollar debts costlier and pulls money out of riskier economies — stress that can rebound on U.S. exporters, markets, and inflation.',
  energy: 'Energy and commodities are global inputs — when they spike, inflation rises and growth slows everywhere, including at home.',
  growth: 'When global demand fades, U.S. exporters, multinationals, and markets feel it — weak global growth is a drag the domestic economy can’t fully escape.',
  financial: 'Financial stress abroad spreads through banks, trade, and currency markets — a localized crisis can become a global one, hitting U.S. markets and credit.',
}
const STAB_WHY: Record<string, string> = {
  capital: 'Steady capital flows and healthy Treasury demand keep global financing conditions calm.',
  energy: 'Calm energy and commodity prices remove a major source of imported inflation.',
  growth: 'Healthy global growth supports U.S. exports, corporate profits, and markets.',
  financial: 'Contained financial stress abroad keeps problems from spreading to U.S. markets.',
}

export type Callout = { text: string; why: string; key: string }

function riskAndStabilizer(cats: Category[], watching: WatchItem[]): { risk: Callout; stabilizer: Callout } {
  const worst = pickWorst(cats)
  const useWatch = !(worst && RANK[worst.tone] >= 2)
  const riskText = !useWatch
    ? (RISK_PHRASE[`${worst.key}:${worst.status}`] ?? `${worst.label}: ${worst.status.toLowerCase()}.`)
    : watching[0] ? `${watching[0].label} approaching its alert — ${watching[0].text}.` : 'No major global risks building right now.'
  const riskKey = useWatch ? (watching[0]?.key ?? worst?.key ?? '') : worst.key

  const goods = cats.filter(c => c.tone === 'good')
  let best: Category | undefined
  if (goods.length) {
    best = [...goods].sort((a, b) => STAB_PREF.indexOf(a.key) - STAB_PREF.indexOf(b.key))[0]
  } else {
    best = [...cats].filter(c => c.key !== riskKey)
      .sort((a, b) => (RANK[a.tone] - RANK[b.tone]) || (STAB_PREF.indexOf(a.key) - STAB_PREF.indexOf(b.key)))[0]
  }
  const stabText = !best ? 'No clear stabilizers right now.'
    : best.tone === 'good' ? (STAB_PHRASE[`${best.key}:${best.status}`] ?? `${best.label} is holding steady.`)
    : `${best.label} is the least-pressing area right now, though no category is a firm stabilizer yet.`
  return {
    risk: { text: riskText, why: RISK_WHY[riskKey] ?? '', key: riskKey },
    stabilizer: { text: stabText, why: STAB_WHY[best?.key ?? ''] ?? '', key: best?.key ?? '' },
  }
}

function buildLastAlert(d: GlobalData): string | null {
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const oil = d.wti.find(o => o.value >= 100)
  if (oil) return `WTI crude last exceeded $100 on ${fmtDate(oil.date)}.`
  // Otherwise the dollar's high in the window — a real, dated reference.
  if (d.dxy.length) {
    let peak = d.dxy[0]
    for (const o of d.dxy) if (o.value > peak.value) peak = o
    return `Global conditions steady — the dollar peaked at ${peak.value.toFixed(1)} on ${fmtDate(peak.date)} and has eased since.`
  }
  return null
}

// ── Summary generator (75–125 words, deterministic) ─────────────────────
function buildSummary(d: GlobalData, cats: Category[], risk: Callout): string {
  const by: Record<string, Category> = Object.fromEntries(cats.map(c => [c.key, c]))
  const cap = by.capital, energy = by.energy, growth = by.growth, fin = by.financial
  const elevated = cats.filter(c => RANK[c.tone] >= 2).length
  const dxy3m = ret(d.dxy, 63)

  const s1 = elevated === 0
    ? 'Global conditions remain broadly stable, with external risks well contained.'
    : 'Global conditions remain broadly stable, though several external pressures are beginning to build.'
  const s2 = `The dollar ${dxy3m != null && dxy3m >= 2 ? 'continues to strengthen, creating additional stress for international borrowers' : dxy3m != null && dxy3m <= -2 ? 'has softened, easing pressure on global borrowers' : 'is broadly steady, keeping pressure off international borrowers'}${energy?.tone === 'good' || energy?.tone === 'neutral' ? ', while energy prices remain well contained' : ', while energy prices are climbing'}.`
  const s3 = growth?.tone === 'good'
    ? 'Commodity demand is firm, pointing to resilient global growth.'
    : growth?.tone === 'warn' || growth?.tone === 'bad' || growth?.tone === 'crisis'
    ? 'Commodity demand is softening, a sign global growth is losing momentum.'
    : 'Commodity demand is stable, suggesting global growth has slowed but not stalled.'
  const s4 = fin?.tone === 'good'
    ? 'Capital flows remain orderly and emerging-market stress is limited, keeping the risk of financial contagion spreading from abroad low.'
    : 'Financial stress is building in emerging markets, raising the risk that problems abroad spill over into domestic markets.'
  const s5 = elevated === 0
    ? 'For now, external conditions pose little threat to the domestic outlook.'
    : 'These external pressures could spill into domestic inflation, credit, and markets if they intensify.'
  // Don't lowercase an acronym lead (e.g. "U.S.", "VIX", "EM").
  const lead = /^[A-Z][A-Z.]/.test(risk.text) ? risk.text : risk.text.charAt(0).toLowerCase() + risk.text.slice(1)
  const s6 = `The primary risk: ${lead}`
  return [s1, s2, s3, s4, s5, s6].filter(Boolean).join(' ')
}

// ── Public entry point ──────────────────────────────────────────────────
export type GlobalModel = {
  available: boolean
  status: GlobalStatus
  subtitle: string
  summary: string
  experiencing: Experiencing
  risk: Callout
  stabilizer: Callout
  categories: Category[]
  alerts: GlobalAlert[]
  lastAlert: string | null
  watching: WatchItem[]
}

const SUBTITLES: Record<string, string> = {
  'Global Stability': 'External conditions are calm — low risk of an imported shock.',
  'Low External Risk': 'Global forces pose little risk to the economy right now.',
  'Stable Global Conditions': 'The global backdrop is steady.',
  'Emerging Risks': 'A few external risks are starting to appear.',
  'Mixed Global Signals': 'Global signals are mixed — no clear direction.',
  'External Pressures Building': 'Pressure is building from abroad.',
  'Rising Global Stress': 'External stress is rising.',
  'Global Pressure Building': 'Global financial pressure is building.',
  'Multiple Risk Signals': 'Several external risks are flashing at once.',
  'Global Stress': 'The global backdrop is under real stress.',
  'Significant External Risk': 'External risks are significant.',
  'International Disruption Risk': 'International disruption is a live risk.',
  'Global Warning': 'Severe global stress is emerging.',
  'Major External Shock': 'A major external shock is underway.',
  'Systemic Global Risk': 'Global financial risk has turned systemic.',
  'Data Unavailable': 'Live global market data is temporarily unavailable.',
}

export async function buildGlobalModel(): Promise<GlobalModel> {
  const data = await fetchGlobalData()

  // The dollar is the keystone — if it's missing, don't fabricate a status.
  if (data.dxy[0]?.value == null) {
    return {
      available: false,
      status: { emoji: '⚪', label: 'Data Unavailable', tone: 'neutral' },
      subtitle: SUBTITLES['Data Unavailable'],
      summary: 'Live global market data is temporarily unavailable. Check back shortly.',
      experiencing: { tone: 'neutral', text: 'Data unavailable' },
      risk: { text: '', why: '', key: '' }, stabilizer: { text: '', why: '', key: '' },
      categories: [], alerts: [], lastAlert: null, watching: [],
    }
  }

  const categories = [scoreCapital(data), scoreEnergy(data), scoreGrowth(data), scoreFinancial(data)].map(withFill)
  const status = overallStatus(categories)
  const alerts = buildAlerts(data)
  const watching = buildWatching(data, alerts)
  const { risk, stabilizer } = riskAndStabilizer(categories, watching)

  return {
    available: true,
    status,
    subtitle: SUBTITLES[status.label] ?? '',
    summary: buildSummary(data, categories, risk),
    experiencing: buildExperiencing(status.tone),
    risk, stabilizer, categories, alerts,
    lastAlert: buildLastAlert(data),
    watching,
  }
}
