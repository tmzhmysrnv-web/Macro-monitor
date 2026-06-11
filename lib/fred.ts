// lib/fred.ts
// Shared FRED fetch used by every FRED caller (fetchData, fetchHistory, housing).
// Two safeguards against FRED's ~120 req/min limit, which a cold page load can
// trip when many series are requested at once (housing ~17 + breakmeter ~13 +
// data ~7 in parallel), returning empty data:
//   1. A process-wide concurrency cap so requests don't all burst at once.
//   2. Retry with exponential backoff (honoring Retry-After) on 429 / 5xx.

type FredInit = RequestInit & { next?: { revalidate?: number } }

const MAX_CONCURRENT = 4
let active = 0
const queue: (() => void)[] = []

function acquire(): Promise<void> {
  return new Promise(resolve => {
    if (active < MAX_CONCURRENT) { active++; resolve() }
    else queue.push(resolve)
  })
}
function release(): void {
  const next = queue.shift()
  if (next) next()      // hand the slot to a waiter; active unchanged
  else active--
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// maxRetries kept low so a genuinely blocked FRED fails fast to the
// data-unavailable guard rather than hanging a cold page load.
export async function fredFetch(url: string, init?: FredInit, maxRetries = 2): Promise<Response | null> {
  await acquire()
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, init)
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const retryAfter = parseFloat(res.headers.get('retry-after') || '')
          const wait = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Math.min(1500 * 2 ** attempt, 8000)
          await sleep(wait + Math.random() * 300) // jitter to de-sync parallel retries
          continue
        }
        return res
      } catch {
        if (attempt >= maxRetries) return null
        await sleep(Math.min(1500 * 2 ** attempt, 8000) + Math.random() * 300)
      }
    }
  } finally {
    release()
  }
}
