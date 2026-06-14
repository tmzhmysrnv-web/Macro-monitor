// lib/redis.ts
// Thin Upstash Redis layer for the notification system: subscriber records,
// per-alert dedup state, and the in-app notification feed. Every helper degrades
// to a no-op / empty result when Redis env vars are absent, so the app still
// builds and runs locally before Upstash is provisioned.

import { Redis } from '@upstash/redis'

let _redis: Redis | null = null

export function redisReady(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

function getRedis(): Redis | null {
  if (_redis) return _redis
  if (!redisReady()) return null
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
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
export type AlertState = { title: string; severity: number; ts: number }

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
