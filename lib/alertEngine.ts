// lib/alertEngine.ts
// Single source of truth for "what is firing right now." Runs every intelligence
// tab's model builder and flattens their .alerts[] into one FiredAlert[]. Both the
// daily cron (email + feed) and the in-app panel ultimately reflect this list, so
// notifications can never disagree with what the tabs show.
//
// buildAlertReport() additionally returns the per-section tone (for the email's
// status-color row) and the overall break level (for the gauge).

import { buildInflationModel } from './inflation'
import { buildLaborModel } from './labor'
import { buildMarketsModel } from './markets'
import { buildGlobalModel } from './global'
import { buildBondModel } from './bonds'
import { buildCreditModel } from './credit'
import { buildHousingModel } from './housing'
import { severityOf, type Severity } from './alertSeverity'
import { fetchAllData } from './fetchData'
import { computeStressIndex } from './stressIndex'
import { getCached } from './redis'

export type FiredAlert = {
  key: string        // `<tab>:<id>` — globally unique dedup key
  id: string
  tab: string
  tabLabel: string
  severity: Severity
  title: string
  what: string
  why: string
  affected: string[]
  context: string
}

// Tone string from each model's overall status (good|neutral|warn|bad|crisis).
export type SectionTone = { tab: string; tabLabel: string; tone: string }

export type WatchHeat = 'near' | 'warming' | 'hot'

export type WatchingItem = {
  key: string
  id: string
  tab: string
  tabLabel: string
  label: string
  text: string
  why: string
  proximity: number
  heat: WatchHeat
}

export type AlertReport = {
  alerts: FiredAlert[]
  watching: WatchingItem[]
  sections: SectionTone[]
  breakLevel: number | null   // 0–100 from the Break Meter
  errors: string[]
}

type GenericAlert = { id: string; title: string; what: string; why: string; affected?: string[]; context?: string }
type GenericWatch = { label: string; text: string; proximity?: number; key?: string }
type GenericModel = { available?: boolean; alerts?: GenericAlert[]; watching?: GenericWatch[]; status?: { tone?: string } }
type AlertReportMode = 'fresh' | 'cached'

const SOURCES: { tab: string; tabLabel: string; cacheKey: string; ttl: number; build: () => Promise<GenericModel> }[] = [
  { tab: 'inflation', tabLabel: 'Inflation', cacheKey: 'inflation', ttl: 3600, build: buildInflationModel },
  { tab: 'labor',     tabLabel: 'Labor',     cacheKey: 'labor',     ttl: 3600, build: buildLaborModel },
  { tab: 'markets',   tabLabel: 'Markets',   cacheKey: 'markets',   ttl: 3600, build: buildMarketsModel },
  { tab: 'global',    tabLabel: 'Global',    cacheKey: 'global',    ttl: 3600, build: buildGlobalModel },
  { tab: 'bonds',     tabLabel: 'Bonds',     cacheKey: 'bonds',     ttl: 300,  build: buildBondModel },
  { tab: 'credit',    tabLabel: 'Credit',    cacheKey: 'credit',    ttl: 3600, build: buildCreditModel },
  { tab: 'housing',   tabLabel: 'Housing',   cacheKey: 'housing',   ttl: 3600, build: buildHousingModel },
]

function buildSource(src: (typeof SOURCES)[number], mode: AlertReportMode): Promise<GenericModel> {
  if (mode === 'fresh') return src.build()
  return getCached(src.cacheKey, src.ttl, src.build, m => m.available !== false)
}

const WATCH_WHY: Record<string, string> = {
  inflation: 'Inflation pressure can squeeze households and keep rates higher before it becomes a fresh alert.',
  labor: 'Labor cracks often start as slower hiring before unemployment or claims cross hard stress lines.',
  markets: 'Market structure can become fragile before the headline index fully rolls over.',
  global: 'External pressure tends to show up first in oil, the dollar, commodities, and global risk assets.',
  bonds: 'Rate pressure moves through mortgages, credit, and valuations even before a policy shock.',
  credit: 'Credit stress usually builds gradually as lenders and borrowers lose room.',
  housing: 'Housing strain can stay contained for a while, then spill into consumers and construction.',
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'watch'
}

function clampProximity(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function heatFor(proximity: number): WatchHeat {
  if (proximity >= 0.9) return 'hot'
  if (proximity >= 0.78) return 'warming'
  return 'near'
}

function normalizeWatching(src: (typeof SOURCES)[number], watches: GenericWatch[] | undefined): WatchingItem[] {
  return (watches ?? [])
    .map((w, i) => {
      const proximity = clampProximity(w.proximity)
      const id = w.key || slug(w.label) || `watch-${i + 1}`
      return {
        key: `${src.tab}:${id}`,
        id,
        tab: src.tab,
        tabLabel: src.tabLabel,
        label: w.label,
        text: w.text,
        why: WATCH_WHY[src.tab] ?? 'This is close enough to keep on the radar, but it has not crossed an alert line.',
        proximity,
        heat: heatFor(proximity),
      }
    })
    .filter(w => w.proximity >= 0.72)
    .sort((a, b) => b.proximity - a.proximity)
    .slice(0, 2)
}

export async function buildAlertReport(opts: { mode?: AlertReportMode } = {}): Promise<AlertReport> {
  const mode = opts.mode ?? 'fresh'
  const [modelResults, breakLevel] = await Promise.all([
    Promise.allSettled(SOURCES.map(s => buildSource(s, mode))),
    fetchAllData().then(d => computeStressIndex(d).total).catch(() => null),
  ])

  const alerts: FiredAlert[] = []
  const watching: WatchingItem[] = []
  const sections: SectionTone[] = []
  const errors: string[] = []

  modelResults.forEach((res, i) => {
    const src = SOURCES[i]
    if (res.status === 'fulfilled') {
      const m = res.value
      sections.push({ tab: src.tab, tabLabel: src.tabLabel, tone: m.status?.tone ?? 'unknown' })
      for (const a of m.alerts ?? []) {
        alerts.push({
          key: `${src.tab}:${a.id}`,
          id: a.id,
          tab: src.tab,
          tabLabel: src.tabLabel,
          severity: severityOf(a.id, a.title),
          title: a.title,
          what: a.what,
          why: a.why,
          affected: a.affected ?? [],
          context: a.context ?? '',
        })
      }
      watching.push(...normalizeWatching(src, m.watching))
    } else {
      errors.push(`${src.tab}: ${res.reason}`)
      sections.push({ tab: src.tab, tabLabel: src.tabLabel, tone: 'unknown' })
    }
  })

  // Most severe first, so digests and the panel lead with what matters.
  alerts.sort((a, b) => b.severity - a.severity)
  watching.sort((a, b) => b.proximity - a.proximity)
  return { alerts, watching: watching.slice(0, 8), sections, breakLevel, errors }
}

// Thin wrapper for callers that only need the alert list (in-app feed dedup).
export async function collectAlerts(): Promise<{ alerts: FiredAlert[]; errors: string[] }> {
  const r = await buildAlertReport()
  return { alerts: r.alerts, errors: r.errors }
}
