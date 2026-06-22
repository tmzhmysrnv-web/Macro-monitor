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
