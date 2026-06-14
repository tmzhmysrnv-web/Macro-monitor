// lib/alertEngine.ts
// Single source of truth for "what is firing right now." Runs every intelligence
// tab's model builder and flattens their .alerts[] into one FiredAlert[]. Both the
// daily cron (email + feed) and the in-app panel ultimately reflect this list, so
// notifications can never disagree with what the tabs show.

import { buildInflationModel } from './inflation'
import { buildLaborModel } from './labor'
import { buildMarketsModel } from './markets'
import { buildGlobalModel } from './global'
import { buildBondModel } from './bonds'
import { buildCreditModel } from './credit'
import { buildHousingModel } from './housing'
import { severityOf, type Severity } from './alertSeverity'

export type FiredAlert = {
  key: string        // `<tab>:<id>` — globally unique dedup key
  id: string
  tab: string
  tabLabel: string
  severity: Severity
  title: string
  what: string
  why: string
}

type GenericAlert = { id: string; title: string; what: string; why: string; affected?: string[]; context?: string }

const SOURCES: { tab: string; tabLabel: string; build: () => Promise<{ alerts?: GenericAlert[] }> }[] = [
  { tab: 'inflation', tabLabel: 'Inflation', build: buildInflationModel },
  { tab: 'labor',     tabLabel: 'Labor',     build: buildLaborModel },
  { tab: 'markets',   tabLabel: 'Markets',   build: buildMarketsModel },
  { tab: 'global',    tabLabel: 'Global',    build: buildGlobalModel },
  { tab: 'bonds',     tabLabel: 'Bonds',     build: buildBondModel },
  { tab: 'credit',    tabLabel: 'Credit',    build: buildCreditModel },
  { tab: 'housing',   tabLabel: 'Housing',   build: buildHousingModel },
]

export async function collectAlerts(): Promise<{ alerts: FiredAlert[]; errors: string[] }> {
  const results = await Promise.allSettled(SOURCES.map(s => s.build()))
  const alerts: FiredAlert[] = []
  const errors: string[] = []

  results.forEach((res, i) => {
    const src = SOURCES[i]
    if (res.status === 'fulfilled') {
      for (const a of res.value.alerts ?? []) {
        alerts.push({
          key: `${src.tab}:${a.id}`,
          id: a.id,
          tab: src.tab,
          tabLabel: src.tabLabel,
          severity: severityOf(a.id, a.title),
          title: a.title,
          what: a.what,
          why: a.why,
        })
      }
    } else {
      errors.push(`${src.tab}: ${res.reason}`)
    }
  })

  // Most severe first, so digests and the panel lead with what matters.
  alerts.sort((a, b) => b.severity - a.severity)
  return { alerts, errors }
}
