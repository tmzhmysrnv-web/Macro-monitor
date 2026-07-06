import { captureError } from './sentry'
import { INTEREST_CATALOG } from './interests'
import { listAlertRecipients } from './recipients'
import { weeklyDigestSent, markWeeklyDigestSent } from './redis'
import { sendWeeklyDigest } from './sendAlert'
import { getCachedDigestBase, digestInterestRows } from './weeklyDigest'

const ALL_CATEGORIES = INTEREST_CATALOG.map(c => c.category)
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export type NewYorkDateParts = {
  year: number
  month: number
  day: number
  dayOfWeek: number
}

export type WeeklyDigestRunOptions = {
  dry?: boolean
  forceEmail?: string
  now?: Date
}

export type WeeklyDigestRunResult =
  | { skipped: 'not Sunday (ET)'; etDay: number }
  | { skipped: 'data unavailable' }
  | { dry: true; recipients: number; total: number; movers: number; events: number }
  | { forced: true; email: string; sent: boolean; recipientResolved: boolean; frequency: string | null; emailEnabled: boolean | null }
  | { week: string; recipients: number; sent: number; skipped: number; failed: number; at: string }

export function newYorkDateParts(now = new Date()): NewYorkDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  const weekday = get('weekday')
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    dayOfWeek: WEEKDAY[weekday] ?? -1,
  }
}

export function isoWeekFromDateParts(parts: Pick<NewYorkDateParts, 'year' | 'month' | 'day'>): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export async function runWeeklyDigest(options: WeeklyDigestRunOptions = {}): Promise<WeeklyDigestRunResult> {
  const dry = options.dry === true
  const forceEmail = options.forceEmail?.trim() ?? ''
  const force = forceEmail.length > 0
  const et = newYorkDateParts(options.now ?? new Date())

  if (!dry && !force && et.dayOfWeek !== 0) {
    return { skipped: 'not Sunday (ET)', etDay: et.dayOfWeek }
  }

  const base = await getCachedDigestBase()
  if (!base) {
    await captureError(new Error('Weekly digest: data unavailable at build time'), { route: 'weekly-digest' })
    return { skipped: 'data unavailable' }
  }

  const recipients = (await listAlertRecipients()).filter(r => r.emailEnabled && r.frequency === 'weekly')

  if (dry) {
    return { dry: true, recipients: recipients.length, total: base.total, movers: base.movers.length, events: base.events.length }
  }

  if (force) {
    const all = await listAlertRecipients()
    const match = all.find(r => r.email.toLowerCase() === forceEmail.toLowerCase())
    const rows = digestInterestRows(match?.interests ?? ALL_CATEGORIES, base.values)
    const ok = await sendWeeklyDigest({ email: forceEmail, token: match?.token ?? 'u:test' }, base, rows)
    return {
      forced: true,
      email: forceEmail,
      sent: ok,
      recipientResolved: !!match,
      frequency: match?.frequency ?? null,
      emailEnabled: match?.emailEnabled ?? null,
    }
  }

  const week = isoWeekFromDateParts(et)
  const results = await Promise.allSettled(recipients.map(async r => {
    if (await weeklyDigestSent(week, r.email)) return 'skipped' as const
    const rows = digestInterestRows(r.interests ?? ALL_CATEGORIES, base.values)
    const ok = await sendWeeklyDigest({ email: r.email, token: r.token }, base, rows)
    if (!ok) return 'failed' as const
    await markWeeklyDigestSent(week, r.email)
    return 'sent' as const
  }))

  const sent = results.filter(r => r.status === 'fulfilled' && r.value === 'sent').length
  const skipped = results.filter(r => r.status === 'fulfilled' && r.value === 'skipped').length
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === 'failed')).length

  if (recipients.length === 0) {
    await captureError(new Error('Weekly digest: 0 eligible weekly recipients'), { route: 'weekly-digest', week })
  } else if (failed > 0) {
    await captureError(new Error(`Weekly digest: ${failed}/${recipients.length} sends failed`), { route: 'weekly-digest', week, sent, failed })
  }

  return { week, recipients: recipients.length, sent, skipped, failed, at: new Date().toISOString() }
}
