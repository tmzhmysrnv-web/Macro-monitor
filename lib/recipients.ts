// lib/recipients.ts
// Resolves WHO an alert digest goes to, and filters each digest to the topics
// that recipient follows. Account preferences take precedence, but legacy
// Upstash subscribers remain eligible while the product transitions to accounts.
import { getSupabaseAdmin } from './supabase/server'
import { listActiveSubscribers } from './redis'
import { TAB_TO_CATEGORIES } from './interests'
import type { FiredAlert } from './alertEngine'

export type AlertRecipient = {
  email: string
  token: string                 // unsubscribe token: Redis token, or `u:<userId>` for accounts
  interests: string[] | null    // null = follows everything (legacy subscriber)
  frequency: 'breaking' | 'weekly'
  emailEnabled: boolean
}

export function mergeAlertRecipients(
  accountRecipients: AlertRecipient[],
  legacyRecipients: AlertRecipient[],
): AlertRecipient[] {
  const byEmail = new Map<string, AlertRecipient>()
  for (const recipient of legacyRecipients) {
    byEmail.set(recipient.email.trim().toLowerCase(), recipient)
  }
  // An account's explicit frequency/interests/unsubscribe token override the
  // legacy all-topics record for the same address.
  for (const recipient of accountRecipients) {
    byEmail.set(recipient.email.trim().toLowerCase(), recipient)
  }
  return [...byEmail.values()]
}

export async function listAlertRecipients(): Promise<AlertRecipient[]> {
  let subs: Awaited<ReturnType<typeof listActiveSubscribers>> = []
  try {
    subs = await listActiveSubscribers()
  } catch (e) {
    // A Redis outage must not hide healthy account recipients.
    console.error('legacy recipients unavailable:', e)
  }
  const legacyRecipients: AlertRecipient[] = subs.map(s => ({
    email: s.email,
    token: s.token,
    interests: null,
    frequency: 'weekly',
    emailEnabled: true,
  }))

  const admin = getSupabaseAdmin()
  if (!admin) return legacyRecipients

  const { data: prefs, error: prefsError } = await admin
    .from('user_preferences')
    .select('user_id, digest_frequency, email_enabled')
    .eq('email_enabled', true)
  if (prefsError) {
    // These legacy records are active opt-ins, so they are the safe delivery
    // fallback when Supabase is temporarily unreachable. The prior behavior
    // silently returned zero recipients and dropped the whole digest.
    console.error(`account recipient preferences unavailable: ${prefsError.message}`)
    return legacyRecipients
  }

  const ids = (prefs ?? []).map(p => p.user_id as string)
  if (ids.length === 0) return legacyRecipients

  const [profilesResult, interestsResult] = await Promise.all([
    admin.from('profiles').select('id, email').in('id', ids),
    admin.from('user_interests').select('user_id, category').in('user_id', ids),
  ])
  if (profilesResult.error || interestsResult.error) {
    const errors = [profilesResult.error?.message, interestsResult.error?.message].filter(Boolean).join('; ')
    console.error(`account recipient details unavailable: ${errors}`)
    return legacyRecipients
  }

  const emailById = new Map((profilesResult.data ?? []).map(p => [p.id as string, p.email as string | null]))
  const interestsById = new Map<string, string[]>()
  for (const r of interestsResult.data ?? []) {
    const arr = interestsById.get(r.user_id as string) ?? []
    arr.push(r.category as string)
    interestsById.set(r.user_id as string, arr)
  }

  const accountRecipients: AlertRecipient[] = []
  for (const p of prefs ?? []) {
    const email = emailById.get(p.user_id as string)
    if (!email) continue
    accountRecipients.push({
      email,
      token: `u:${p.user_id}`,
      interests: interestsById.get(p.user_id as string) ?? [],
      frequency: (p.digest_frequency as AlertRecipient['frequency']) ?? 'weekly',
      emailEnabled: true,
    })
  }
  return mergeAlertRecipients(accountRecipients, legacyRecipients)
}

// Narrow a digest's alerts to the ones on tabs the recipient follows.
// null interests = follows everything; empty array = follows nothing.
export function alertsForRecipient(alerts: FiredAlert[], r: AlertRecipient): FiredAlert[] {
  if (r.interests == null) return alerts
  const follows = new Set(r.interests)
  return alerts.filter(a => (TAB_TO_CATEGORIES[a.tab] ?? []).some(c => follows.has(c)))
}
