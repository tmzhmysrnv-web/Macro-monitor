// lib/redis.ts
// Thin Upstash Redis layer for the notification system: subscriber records,
// per-alert dedup state, and the in-app notification feed. Every helper degrades
// to a no-op / empty result when Redis env vars are absent, so the app still
// builds and runs locally before Upstash is provisioned.

import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

// Accept both naming schemes: the bare Upstash vars and the KV_* names that
// Vercel's Upstash/KV marketplace integration injects (KV_REST_API_URL /
// KV_REST_API_TOKEN). The REST client needs the REST pair, not KV_URL (TCP).
const restUrl = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const restToken = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

export function redisReady(): boolean {
  return !!(restUrl() && restToken())
}

function getRedis(): Redis | null {
  if (_redis) return _redis
  if (!redisReady()) return null
  _redis = new Redis({ url: restUrl()!, token: restToken()! })
  return _redis
}

// ── Read-through cache for computed payloads ──────────────────────────
// Caches expensive FRED-derived payloads (the landing bundle, each tab model)
// in Redis so we compute once per `freshTtl` instead of on every request. This
// is the ORIGIN-side cache: it collapses the redundant FRED calls a cold page
// load / tab-warm fan-out makes, and — crucially — survives FRED rate-limit
// blips. We keep TWO keys per payload:
//   cache:<key>  — the fresh copy, expires after freshTtl (the served-as-current window)
//   stale:<key>  — the last KNOWN-GOOD copy, kept ~a day, served when a rebuild fails
// so a momentary FRED outage serves slightly-stale-but-real data instead of the
// "data temporarily unavailable" state. Only OK payloads are ever written, so a
// rate-limited build can't poison either key. Degrades to a live build when Redis
// is absent (local dev) or on any Redis error.
export async function getCached<T>(
  key: string,
  freshTtl: number,
  build: () => Promise<T>,
  isOk: (v: T) => boolean,
  staleTtl = 86400,
): Promise<T> {
  const r = getRedis()
  if (!r) return build()
  const freshKey = `cache:${key}`
  const staleKey = `stale:${key}`
  try {
    const hit = await r.get<T>(freshKey)
    if (hit) return hit
  } catch (e) { console.error(`getCached read ${key}`, e) }

  const fresh = await build()
  if (isOk(fresh)) {
    try {
      await Promise.all([
        r.set(freshKey, fresh, { ex: freshTtl }),
        r.set(staleKey, fresh, { ex: staleTtl }),
      ])
    } catch (e) { console.error(`getCached write ${key}`, e) }
    return fresh
  }
  // Rebuild failed (FRED rate-limited / sparse): serve last known-good if we have it.
  try {
    const stale = await r.get<T>(staleKey)
    if (stale) return stale
  } catch (e) { console.error(`getCached stale ${key}`, e) }
  return fresh
}

// ── Rate limiting ─────────────────────────────────────────────────────
// Fixed-window counter: INCR a key, set its TTL on first hit. Degrades to
// "allow" when Redis is absent so the app still runs locally without Upstash.
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; remaining: number }> {
  const r = getRedis()
  if (!r) return { ok: true, remaining: limit }
  const k = `rl:${key}`
  const n = await r.incr(k)
  if (n === 1) await r.expire(k, windowSec)
  return { ok: n <= limit, remaining: Math.max(0, limit - n) }
}

// ── Break Meter daily snapshots ───────────────────────────────────────
// One total per day (hash date->total), so week-over-week change survives the
// FRED-history hiccups that make the on-the-fly reconstruction (buildMeterChange)
// drop out. The total itself comes from current values, which stay available
// even when historical series are rate-limited.
const BM_HISTORY = 'bm:history'

export async function recordBreakMeterTotal(total: number): Promise<Record<string, number>> {
  const r = getRedis(); if (!r) return {}
  const today = new Date().toISOString().slice(0, 10)
  await r.hset(BM_HISTORY, { [today]: Math.round(total) })
  const all = (await r.hgetall<Record<string, number>>(BM_HISTORY)) ?? {}
  const cutoff = Date.now() - 31 * 86400000
  const stale = Object.keys(all).filter(d => new Date(d).getTime() < cutoff)
  if (stale.length) await r.hdel(BM_HISTORY, ...stale)
  return all
}

// Pick the snapshot closest to 7 days ago (within a 6–8 day window) and return
// currentTotal − that. null when there's no comparable snapshot yet.
export function weekChangeFromSnapshots(snapshots: Record<string, number>, currentTotal: number): number | null {
  const now = Date.now()
  let best: { off: number; total: number } | null = null
  for (const [date, total] of Object.entries(snapshots)) {
    const days = (now - new Date(date).getTime()) / 86400000
    if (days >= 6 && days <= 8) {
      const off = Math.abs(days - 7)
      if (!best || off < best.off) best = { off, total: Number(total) }
    }
  }
  return best ? Math.round(currentTotal) - best.total : null
}

// ── Subscribers ───────────────────────────────────────────────────────
export type SubStatus = 'pending' | 'active' | 'unsubscribed'
export type Subscriber = {
  email: string
  status: SubStatus
  token: string
  createdAt: string
  confirmedAt?: string
}

const subKey = (email: string) => `sub:${email.toLowerCase()}`
const tokKey = (token: string) => `tok:${token}`
const SUBSET = 'subscribers:emails'

export async function getSubscriber(email: string): Promise<Subscriber | null> {
  const r = getRedis(); if (!r) return null
  return (await r.get<Subscriber>(subKey(email))) ?? null
}

export async function getSubscriberByToken(token: string): Promise<Subscriber | null> {
  const r = getRedis(); if (!r) return null
  const email = await r.get<string>(tokKey(token))
  if (!email) return null
  return getSubscriber(email)
}

export async function upsertSubscriber(sub: Subscriber): Promise<void> {
  const r = getRedis(); if (!r) return
  const email = sub.email.toLowerCase()
  await Promise.all([
    r.set(subKey(email), sub),
    r.set(tokKey(sub.token), email),
    r.sadd(SUBSET, email),
  ])
}

export async function listActiveSubscribers(): Promise<Subscriber[]> {
  const r = getRedis(); if (!r) return []
  const emails = await r.smembers(SUBSET)
  if (!emails?.length) return []
  const subs = await Promise.all(emails.map(e => getSubscriber(e)))
  return subs.filter((s): s is Subscriber => !!s && s.status === 'active')
}

// ── Per-alert dedup state ─────────────────────────────────────────────
// Keyed by the alert's composite key (`<tab>:<id>`) so the same id on two tabs
// can't collide. Stored in one hash so we can clear cleared alerts in one call.
const ALERT_STATE = 'alertstate'
// `severity` holds the family RANK. `firing:false` = a tombstone kept during the
// cooldown window after an alert clears; `notifiedTs` = when we last emailed it.
export type AlertState = { title: string; severity: number; ts: number; notifiedTs?: number; firing?: boolean }

export async function getAlertStates(): Promise<Record<string, AlertState>> {
  const r = getRedis(); if (!r) return {}
  return (await r.hgetall<Record<string, AlertState>>(ALERT_STATE)) ?? {}
}

export async function setAlertStates(states: Record<string, AlertState>): Promise<void> {
  const r = getRedis(); if (!r || Object.keys(states).length === 0) return
  await r.hset(ALERT_STATE, states)
}

export async function clearAlertStates(keys: string[]): Promise<void> {
  const r = getRedis(); if (!r || keys.length === 0) return
  await r.hdel(ALERT_STATE, ...keys)
}

// ── In-app notification feed ──────────────────────────────────────────
const FEED = 'feed'
const FEED_MAX = 50
export type FeedItem = {
  key: string
  tab: string
  tabLabel: string
  severity: number
  title: string
  what: string
  ts: number
}

export async function pushFeed(items: FeedItem[]): Promise<void> {
  const r = getRedis(); if (!r || items.length === 0) return
  // LPUSH newest-first, then trim to the cap.
  await r.lpush(FEED, ...items)
  await r.ltrim(FEED, 0, FEED_MAX - 1)
}

export async function getFeed(limit = FEED_MAX): Promise<FeedItem[]> {
  const r = getRedis(); if (!r) return []
  return (await r.lrange<FeedItem>(FEED, 0, limit - 1)) ?? []
}

// ── Latest Fed decision (parsed from the FOMC statement) ──────────────
// Lets the Fed Policy banner flip the moment the 2pm statement posts, before
// FRED's DFEDTARU publishes the new target (which lags ~a day).
const FED_DECISION = 'fed:lastDecision'
export type FedDecisionStore = {
  upper: number
  lower: number
  direction: 'hike' | 'cut' | 'hold'
  date: string          // YYYY-MM-DD (decision day)
  statementUrl: string
  fetchedAt: number
}

export async function getFedDecision(): Promise<FedDecisionStore | null> {
  const r = getRedis(); if (!r) return null
  return (await r.get<FedDecisionStore>(FED_DECISION)) ?? null
}

export async function setFedDecision(d: FedDecisionStore): Promise<void> {
  const r = getRedis(); if (!r) return
  await r.set(FED_DECISION, d)
}

// ── Weekly digest dedup ───────────────────────────────────────────────
// A daily cron fires the Sunday digest; this prevents a double-send if the cron
// runs twice. Keyed by ISO week; members are recipient ids (email or user id).
const weeklyKey = (week: string) => `wd:${week}`

export async function weeklyDigestSent(week: string, id: string): Promise<boolean> {
  const r = getRedis(); if (!r) return false
  return (await r.sismember(weeklyKey(week), id)) === 1
}

export async function markWeeklyDigestSent(week: string, id: string): Promise<void> {
  const r = getRedis(); if (!r) return
  await r.sadd(weeklyKey(week), id)
  await r.expire(weeklyKey(week), 60 * 60 * 24 * 14) // keep ~2 weeks, then forget
}

const WEEKLY_DIGEST_RUNS = 'wd:runs'
const WEEKLY_DIGEST_RUNS_MAX = 30
export type WeeklyDigestRunReceipt = {
  startedAt: string
  finishedAt: string
  durationMs: number
  mode: 'scheduled' | 'dry' | 'forced'
  outcome: 'skipped' | 'completed' | 'failed'
  detail: string
  recipients?: number
  sent?: number
  skipped?: number
  failed?: number
}

export async function recordWeeklyDigestRun(receipt: WeeklyDigestRunReceipt): Promise<void> {
  const r = getRedis(); if (!r) return
  await r.lpush(WEEKLY_DIGEST_RUNS, receipt)
  await r.ltrim(WEEKLY_DIGEST_RUNS, 0, WEEKLY_DIGEST_RUNS_MAX - 1)
}

export async function getWeeklyDigestRuns(limit = 10): Promise<WeeklyDigestRunReceipt[]> {
  const r = getRedis(); if (!r) return []
  return (await r.lrange<WeeklyDigestRunReceipt>(WEEKLY_DIGEST_RUNS, 0, Math.max(0, limit - 1))) ?? []
}

// ── Admin / testing maintenance ───────────────────────────────────────
// Removes every subscriber (sub:*, tok:*, and the index set). Returns the count.
export async function resetSubscribers(): Promise<number> {
  const r = getRedis(); if (!r) return 0
  const emails = await r.smembers(SUBSET)
  let n = 0
  for (const e of emails) {
    const sub = await getSubscriber(e)
    const keys = [subKey(e)]
    if (sub?.token) keys.push(tokKey(sub.token))
    await r.del(...keys)
    n++
  }
  await r.del(SUBSET)
  return n
}

// Clears the in-app feed + per-alert dedup state (so the next cron re-notifies).
export async function resetFeedAndAlertState(): Promise<void> {
  const r = getRedis(); if (!r) return
  await r.del(FEED, ALERT_STATE)
}
