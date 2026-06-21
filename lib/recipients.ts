// lib/recipients.ts
// Resolves WHO an alert digest goes to, and filters each digest to the topics
// that recipient follows. When Supabase is configured, recipients come from the
// account system (profiles + preferences + interests). Otherwise it falls back
// to the legacy Upstash email subscribers (who follow everything).
import { getSupabaseAdmin } from './supabase/server'
import { listActiveSubscribers } from './redis'
import { TAB_TO_CATEGORIES } from './interests'
import type { FiredAlert } from './alertEngine'

export type AlertRecipient = {
  email: string
  token: string                 // unsubscribe token: Redis token, or `u:<userId>` for accounts
  interests: string[] | null    // null = follows everything (legacy subscriber)
  frequency: 'breaking' | 'daily' | 'weekly'
  emailEnabled: boolean
}

export async function listAlertRecipients(): Promise<AlertRecipient[]> {
  const admin = getSupabaseAdmin()
  if (admin) {
    const { data: prefs } = await admin
      .from('user_preferences')
      .select('user_id, digest_frequency, email_enabled')
      .eq('email_enabled', true)
    const ids = (prefs ?? []).map(p => p.user_id as string)
    if (ids.length === 0) return []

    const [{ data: profs }, { data: ints }] = await Promise.all([
      admin.from('profiles').select('id, email').in('id', ids),
      admin.from('user_interests').select('user_id, category').in('user_id', ids),
    ])
    const emailById = new Map((profs ?? []).map(p => [p.id as string, p.email as string | null]))
    const interestsById = new Map<string, string[]>()
    for (const r of ints ?? []) {
      const arr = interestsById.get(r.user_id as string) ?? []
      arr.push(r.category as string)
      interestsById.set(r.user_id as string, arr)
    }

    const out: AlertRecipient[] = []
    for (const p of prefs ?? []) {
      const email = emailById.get(p.user_id as string)
      if (!email) continue
      out.push({
        email,
        token: `u:${p.user_id}`,
        interests: interestsById.get(p.user_id as string) ?? [],
        frequency: (p.digest_frequency as AlertRecipient['frequency']) ?? 'weekly',
        emailEnabled: true,
      })
    }
    return out
  }

  // Fallback: legacy email-only subscribers follow every topic.
  const subs = await listActiveSubscribers()
  return subs.map(s => ({ email: s.email, token: s.token, interests: null, frequency: 'weekly', emailEnabled: true }))
}

// Narrow a digest's alerts to the ones on tabs the recipient follows.
// null interests = follows everything; empty array = follows nothing.
export function alertsForRecipient(alerts: FiredAlert[], r: AlertRecipient): FiredAlert[] {
  if (r.interests == null) return alerts
  const follows = new Set(r.interests)
  return alerts.filter(a => (TAB_TO_CATEGORIES[a.tab] ?? []).some(c => follows.has(c)))
}
