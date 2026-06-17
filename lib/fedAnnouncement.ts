// lib/fedAnnouncement.ts
// Near-real-time FOMC decision capture. The Fed's monetary-policy RSS posts the
// FOMC statement at 2:00pm ET on decision days — well before FRED publishes the
// new target range (DFEDTARU lags ~a day). We poll that feed, fetch the linked
// statement, and parse the announced target range + whether they held/cut/hiked,
// so the Fed Policy banner can flip the moment the decision lands.
//
// The Fed doesn't offer webhooks, so this is polled (cheaply, cached) — by the
// per-request backstop in buildBondModel during a decision window, and/or by a
// cron hitting /api/fed-poll. ToS-clean: federalreserve.gov is a public source
// that permits this (unlike CME, which blocks scraping).

import type { FedDecisionStore } from './redis'

const RSS_URL = 'https://www.federalreserve.gov/feeds/press_monetary.xml'

// "3-3/4" → 3.75, "4" → 4, "3 1/2" → 3.5
function parseRate(s: string): number | null {
  const m = s.trim().match(/^(\d+)(?:[\s-](\d+)\/(\d+))?$/)
  if (!m) return null
  let v = parseInt(m[1], 10)
  if (m[2] && m[3]) v += parseInt(m[2], 10) / parseInt(m[3], 10)
  return parseFloat(v.toFixed(4))
}

function dateFromUrl(url: string): string | null {
  const m = url.match(/monetary(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// Fetch + parse the most recent FOMC statement. Returns null if the feed has no
// FOMC statement or the target-range sentence can't be parsed (fail safe — the
// banner just falls back to FRED).
export async function fetchFedAnnouncement(): Promise<FedDecisionStore | null> {
  try {
    const res = await fetch(RSS_URL, { next: { revalidate: 300 } })
    if (!res || !res.ok) return null
    const xml = await res.text()

    // Find the first item that is an FOMC statement; grab its link.
    let link: string | null = null
    for (const block of xml.split(/<item>/i).slice(1)) {
      const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ''
      if (/FOMC statement/i.test(title)) {
        link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? '').trim()
        break
      }
    }
    if (!link) return null

    const sres = await fetch(link, { next: { revalidate: 300 } })
    if (!sres || !sres.ok) return null
    const html = await sres.text()

    // "decided to maintain|lower|raise the target range for the federal funds
    // rate at|to 3-1/2 to 3-3/4 percent" — verb gives direction, then lower/upper.
    const m = html.match(/\b(maintain|lower|raise|reduce|increase)\s+the\s+target\s+range\s+for\s+the\s+federal\s+funds\s+rate\s+(?:to|at)\s+([\d\s/\-]+?)\s+to\s+([\d\s/\-]+?)\s+percent/i)
    if (!m) return null
    const lower = parseRate(m[2]), upper = parseRate(m[3])
    if (lower == null || upper == null) return null

    const verb = m[1].toLowerCase()
    const direction: FedDecisionStore['direction'] =
      verb === 'maintain' ? 'hold' : (verb === 'lower' || verb === 'reduce') ? 'cut' : 'hike'

    return {
      upper, lower, direction,
      date: dateFromUrl(link) ?? new Date().toISOString().slice(0, 10),
      statementUrl: link,
      fetchedAt: Date.now(),
    }
  } catch {
    return null
  }
}
