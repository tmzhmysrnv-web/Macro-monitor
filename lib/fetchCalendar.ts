// lib/fetchCalendar.ts
// High-impact US economic events — recent (past ~3 weeks) and upcoming (~30 days).
// Hardcoded 2026 release schedule (BLS/Fed publish these 12 months ahead):
//   https://www.bls.gov/schedule/news_release/cpi.htm
//   https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm

export type EconomicEvent = {
  name: string
  date: string        // ISO date string
  daysUntil: number   // negative = in the past
  importance: 'high' | 'medium'
  description: string
  metricKey?: string  // indicator this release moves (for the "outcome" + chart)
}

// Which tracked indicator each release prints into (for past-event outcomes)
const METRIC_BY_EVENT: Record<string, string> = {
  'CPI Report': 'cpi',
  'FOMC Decision': 'fedfunds',
}

type Sched = { name: string; date: string; importance: 'high'; description: string }

const SCHEDULE: Sched[] = [
  // CPI releases 2026 (BLS — always ~2nd week of month)
  { name: 'CPI Report', date: '2026-01-14', importance: 'high', description: 'Consumer Price Index — Dec 2025 data' },
  { name: 'CPI Report', date: '2026-02-11', importance: 'high', description: 'Consumer Price Index — Jan 2026 data' },
  { name: 'CPI Report', date: '2026-03-11', importance: 'high', description: 'Consumer Price Index — Feb 2026 data' },
  { name: 'CPI Report', date: '2026-04-10', importance: 'high', description: 'Consumer Price Index — Mar 2026 data' },
  { name: 'CPI Report', date: '2026-05-13', importance: 'high', description: 'Consumer Price Index — Apr 2026 data' },
  { name: 'CPI Report', date: '2026-06-11', importance: 'high', description: 'Consumer Price Index — May 2026 data' },
  { name: 'CPI Report', date: '2026-07-14', importance: 'high', description: 'Consumer Price Index — Jun 2026 data' },
  { name: 'CPI Report', date: '2026-08-12', importance: 'high', description: 'Consumer Price Index — Jul 2026 data' },
  { name: 'CPI Report', date: '2026-09-11', importance: 'high', description: 'Consumer Price Index — Aug 2026 data' },
  { name: 'CPI Report', date: '2026-10-14', importance: 'high', description: 'Consumer Price Index — Sep 2026 data' },
  { name: 'CPI Report', date: '2026-11-12', importance: 'high', description: 'Consumer Price Index — Oct 2026 data' },
  { name: 'CPI Report', date: '2026-12-11', importance: 'high', description: 'Consumer Price Index — Nov 2026 data' },
  // Jobs Report (NFP) 2026 — always first Friday of month
  { name: 'Jobs Report', date: '2026-01-09', importance: 'high', description: 'Non-Farm Payrolls — Dec 2025 data' },
  { name: 'Jobs Report', date: '2026-02-06', importance: 'high', description: 'Non-Farm Payrolls — Jan 2026 data' },
  { name: 'Jobs Report', date: '2026-03-06', importance: 'high', description: 'Non-Farm Payrolls — Feb 2026 data' },
  { name: 'Jobs Report', date: '2026-04-03', importance: 'high', description: 'Non-Farm Payrolls — Mar 2026 data' },
  { name: 'Jobs Report', date: '2026-05-08', importance: 'high', description: 'Non-Farm Payrolls — Apr 2026 data' },
  { name: 'Jobs Report', date: '2026-06-05', importance: 'high', description: 'Non-Farm Payrolls — May 2026 data' },
  { name: 'Jobs Report', date: '2026-07-09', importance: 'high', description: 'Non-Farm Payrolls — Jun 2026 data' },
  { name: 'Jobs Report', date: '2026-08-07', importance: 'high', description: 'Non-Farm Payrolls — Jul 2026 data' },
  { name: 'Jobs Report', date: '2026-09-04', importance: 'high', description: 'Non-Farm Payrolls — Aug 2026 data' },
  { name: 'Jobs Report', date: '2026-10-02', importance: 'high', description: 'Non-Farm Payrolls — Sep 2026 data' },
  { name: 'Jobs Report', date: '2026-11-06', importance: 'high', description: 'Non-Farm Payrolls — Oct 2026 data' },
  { name: 'Jobs Report', date: '2026-12-04', importance: 'high', description: 'Non-Farm Payrolls — Nov 2026 data' },
  // FOMC meetings 2026
  { name: 'FOMC Decision', date: '2026-01-29', importance: 'high', description: 'Federal Reserve interest rate decision' },
  { name: 'FOMC Decision', date: '2026-03-19', importance: 'high', description: 'Federal Reserve interest rate decision' },
  { name: 'FOMC Decision', date: '2026-05-07', importance: 'high', description: 'Federal Reserve interest rate decision' },
  { name: 'FOMC Decision', date: '2026-06-18', importance: 'high', description: 'Federal Reserve interest rate decision' },
  { name: 'FOMC Decision', date: '2026-07-30', importance: 'high', description: 'Federal Reserve interest rate decision' },
  { name: 'FOMC Decision', date: '2026-09-17', importance: 'high', description: 'Federal Reserve interest rate decision' },
  { name: 'FOMC Decision', date: '2026-11-05', importance: 'high', description: 'Federal Reserve interest rate decision' },
  { name: 'FOMC Decision', date: '2026-12-16', importance: 'high', description: 'Federal Reserve interest rate decision' },
  // GDP releases 2026 (advance estimate — ~4 weeks after quarter end)
  { name: 'GDP (Advance)', date: '2026-01-29', importance: 'high', description: 'Q4 2025 GDP advance estimate' },
  { name: 'GDP (Advance)', date: '2026-04-29', importance: 'high', description: 'Q1 2026 GDP advance estimate' },
  { name: 'GDP (Advance)', date: '2026-07-29', importance: 'high', description: 'Q2 2026 GDP advance estimate' },
  { name: 'GDP (Advance)', date: '2026-10-28', importance: 'high', description: 'Q3 2026 GDP advance estimate' },
]

function buildEvents(minDays: number, maxDays: number): EconomicEvent[] {
  const now = new Date()
  return SCHEDULE
    .map(e => {
      const eventDate = new Date(e.date + 'T08:30:00-05:00')
      const daysUntil = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      return { ...e, daysUntil, metricKey: METRIC_BY_EVENT[e.name] }
    })
    .filter(e => e.daysUntil >= minDays && e.daysUntil <= maxDays)
    .sort((a, b) => a.daysUntil - b.daysUntil)
}

// Recent (last ~3 weeks) + upcoming (next ~30 days), for the calendar UI.
export function getCalendarEvents(): EconomicEvent[] {
  return buildEvents(-21, 30)
}

// Upcoming only — used by the daily-summary context.
export function getUpcomingEvents(): EconomicEvent[] {
  return buildEvents(0, 30)
}

export function getCalendarContext(): string {
  const events = getUpcomingEvents()
  if (events.length === 0) return 'No major economic releases in the next 30 days.'

  const lines = events.slice(0, 5).map(e => {
    const when = e.daysUntil === 0 ? 'TODAY'
      : e.daysUntil === 1 ? 'tomorrow'
      : `in ${e.daysUntil} days (${new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
    return `• ${e.name} — ${when}: ${e.description}`
  })

  return `Upcoming releases:\n${lines.join('\n')}`
}
