// lib/bundle.ts
// Single-request aggregation of everything the public landing page needs:
// raw data + the Break Meter + all seven intelligence tabs + the calendar.
// Building them together in ONE serverless invocation lets Next dedupe the
// shared FRED/Yahoo fetches (each unique series is fetched once per request),
// replacing the old ~9-endpoint client fan-out. Consumed by getStaticProps
// (ISR) on the landing page and by /api/all (client refresh).
//
// Each tab object mirrors its /api/<tab> endpoint EXACTLY so the existing tab
// components render the bundled `initialData` with no shape changes.
import { fetchAllData } from './fetchData'
import { buildBreakMeterPayload } from './breakMeter'
import { buildBondModel, type BondModel } from './bonds'
import { buildHousingModel, type HousingModel } from './housing'
import { buildCreditModel, type CreditModel } from './credit'
import { buildInflationModel } from './inflation'
import { buildMarketsModel } from './markets'
import { buildLaborModel } from './labor'
import { buildGlobalModel } from './global'
import { fetchEvents, recentAndUpcoming } from './economicCalendar'
import { getSupabaseAdmin } from './supabase/server'

// ── Endpoint-local summaries (kept identical to pages/api/{bonds,housing,credit}.ts) ──
function bondSummary(m: BondModel): string {
  if (!m.available) return 'Live bond-market data is temporarily unavailable. Check back shortly.'
  const by: Record<string, string> = Object.fromEntries(m.categories.map(c => [c.key, c.status]))
  const stress = (by.stress || '').replace(/ Markets$/, '').toLowerCase() || 'orderly'
  const themes = `Growth expectations read ${(by.growth || '').toLowerCase()}, financing conditions are ${(by.rates || '').toLowerCase()}, and government financing shows ${(by.financing || '').toLowerCase()} — with Treasury markets ${stress}.`
  return [themes, m.risk.text].filter(Boolean).join(' ')
}
function housingSummary(m: HousingModel): string {
  if (!m.available) return 'Live housing data is temporarily unavailable. Check back shortly.'
  const by: Record<string, string> = Object.fromEntries(m.categories.map(c => [c.key, c.status]))
  const themes = `Affordability is ${(by.affordability || '').toLowerCase()}, supply ${(by.supply || '').toLowerCase()}, demand ${(by.demand || '').toLowerCase()}, and financial stress ${(by.stress || '').toLowerCase()}.`
  return [themes, m.risk.text].filter(Boolean).join(' ')
}
function creditSummary(m: CreditModel): string {
  if (!m.available) return 'Live credit-market data is temporarily unavailable. Check back shortly.'
  const by: Record<string, string> = Object.fromEntries(m.categories.map(c => [c.key, c.status]))
  const themes = `Lending conditions are ${(by.lending || '').toLowerCase()}, corporate credit is ${(by.corporate || '').toLowerCase()}, consumer credit is ${(by.consumer || '').toLowerCase()}, and financial-system stress is ${(by.financial || '').toLowerCase()}.`
  return [themes, m.risk.text].filter(Boolean).join(' ')
}

async function safe<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try { return await fn() } catch (e) { console.error(`bundle: ${label} failed`, e); return null }
}

export async function buildBundle() {
  const at = () => new Date().toISOString()
  const [data, breakmeter, bondM, housingM, creditM, inflationM, marketsM, laborM, globalM, eventsRaw] =
    await Promise.all([
      safe(() => fetchAllData(), 'data'),
      safe(() => buildBreakMeterPayload(), 'breakmeter'),
      safe(() => buildBondModel(), 'bonds'),
      safe(() => buildHousingModel(), 'housing'),
      safe(() => buildCreditModel(), 'credit'),
      safe(() => buildInflationModel(), 'inflation'),
      safe(() => buildMarketsModel(), 'markets'),
      safe(() => buildLaborModel(), 'labor'),
      safe(() => buildGlobalModel(), 'global'),
      safe(() => fetchEvents(getSupabaseAdmin()), 'events'),
    ])

  const bonds = bondM && {
    available: bondM.available, status: bondM.status, subtitle: bondM.subtitle,
    summary: bondSummary(bondM), risk: bondM.risk, stabilizer: bondM.stabilizer,
    categories: bondM.categories, alerts: bondM.alerts, lastAlert: bondM.lastAlert,
    watching: bondM.watching, fedPolicy: bondM.fedPolicy, fedWatch: bondM.fedWatch,
    rateExpectation: bondM.rateExpectation, fetchedAt: at(),
  }
  const housing = housingM && {
    available: housingM.available, status: housingM.status, subtitle: housingM.subtitle,
    summary: housingSummary(housingM), risk: housingM.risk, stabilizer: housingM.stabilizer,
    categories: housingM.categories, alerts: housingM.alerts, lastAlert: housingM.lastAlert,
    watching: housingM.watching, fetchedAt: at(),
  }
  const credit = creditM && {
    available: creditM.available, status: creditM.status, subtitle: creditM.subtitle,
    summary: creditSummary(creditM), risk: creditM.risk, stabilizer: creditM.stabilizer,
    categories: creditM.categories, alerts: creditM.alerts, lastAlert: creditM.lastAlert,
    watching: creditM.watching, fetchedAt: at(),
  }
  const inflation = inflationM && {
    available: inflationM.available, status: inflationM.status, subtitle: inflationM.subtitle,
    summary: inflationM.summary, risk: inflationM.risk, stabilizer: inflationM.stabilizer,
    categories: inflationM.categories, alerts: inflationM.alerts, lastAlert: inflationM.lastAlert,
    watching: inflationM.watching, fetchedAt: at(),
  }
  const markets = marketsM && {
    available: marketsM.available, status: marketsM.status, subtitle: marketsM.subtitle,
    summary: marketsM.summary, doing: marketsM.doing, risk: marketsM.risk, stabilizer: marketsM.stabilizer,
    categories: marketsM.categories, alerts: marketsM.alerts, lastAlert: marketsM.lastAlert,
    watching: marketsM.watching, fetchedAt: at(),
  }
  const labor = laborM && {
    available: laborM.available, status: laborM.status, subtitle: laborM.subtitle,
    summary: laborM.summary, experience: laborM.experience, risk: laborM.risk, stabilizer: laborM.stabilizer,
    categories: laborM.categories, alerts: laborM.alerts, lastAlert: laborM.lastAlert,
    watching: laborM.watching, fetchedAt: at(),
  }
  const global = globalM && {
    available: globalM.available, status: globalM.status, subtitle: globalM.subtitle,
    summary: globalM.summary, experiencing: globalM.experiencing, risk: globalM.risk, stabilizer: globalM.stabilizer,
    categories: globalM.categories, alerts: globalM.alerts, lastAlert: globalM.lastAlert,
    watching: globalM.watching, fetchedAt: at(),
  }

  const events = eventsRaw ? recentAndUpcoming(eventsRaw) : []

  return {
    data: data ?? null,
    breakmeter: breakmeter ?? null,
    bonds: bonds ?? null,
    housing: housing ?? null,
    credit: credit ?? null,
    inflation: inflation ?? null,
    markets: markets ?? null,
    labor: labor ?? null,
    global: global ?? null,
    events,
  }
}

export type Bundle = Awaited<ReturnType<typeof buildBundle>>
