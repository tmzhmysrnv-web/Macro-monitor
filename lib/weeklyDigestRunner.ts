import { captureError } from './sentry'
import { INTEREST_CATALOG } from './interests'
import { listAlertRecipients } from './recipients'
import {
  weeklyDigestSent, markWeeklyDigestSent, recordWeeklyDigestRun,
  type WeeklyDigestRunReceipt,
} from './redis'
import { sendWeeklyDigest } from './sendAlert'
import { getCachedDigestBase, digestInterestRows } from './weeklyDigest'

const ALL_CATEGORIES = INTEREST_CATALOG.map(c => c.category)
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const DATA_TIMEOUT_MS = 120_000
const RECIPIENT_TIMEOUT_MS = 20_000
const REDIS_TIMEOUT_MS = 10_000
const SEND_TIMEOUT_MS = 30_000

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

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
  const startedMs = Date.now()
  const startedAt = new Date(startedMs).toISOString()
  const dry = options.dry === true
  const forceEmail = options.forceEmail?.trim() ?? ''
  const force = forceEmail.length > 0
  const mode: WeeklyDigestRunReceipt['mode'] = dry ? 'dry' : force ? 'forced' : 'scheduled'
  const et = newYorkDateParts(options.now ?? new Date())

  const record = async (receipt: Omit<WeeklyDigestRunReceipt, 'startedAt' | 'finishedAt' | 'durationMs' | 'mode'>) => {
    const finishedMs = Date.now()
    try {
      await withTimeout(recordWeeklyDigestRun({
        ...receipt,
        startedAt,
        finishedAt: new Date(finishedMs).toISOString(),
        durationMs: finishedMs - startedMs,
        mode,
      }), REDIS_TIMEOUT_MS, 'weekly digest receipt')
    } catch (e) {
      console.error('Weekly digest receipt failed:', e)
    }
  }

  try {
    if (!dry && !force && et.dayOfWeek !== 0) {
      const result = { skipped: 'not Sunday (ET)' as const, etDay: et.dayOfWeek }
      await record({ outcome: 'skipped', detail: result.skipped })
      return result
    }

    const base = await withTimeout(getCachedDigestBase(), DATA_TIMEOUT_MS, 'weekly digest data')
    if (!base) {
      await captureError(new Error('Weekly digest: data unavailable at build time'), { route: 'weekly-digest' })
      const result = { skipped: 'data unavailable' as const }
      await record({ outcome: 'skipped', detail: result.skipped })
      return result
    }

    const allRecipients = await withTimeout(listAlertRecipients(), RECIPIENT_TIMEOUT_MS, 'weekly digest recipients')
    const recipients = allRecipients.filter(r => r.emailEnabled && r.frequency === 'weekly')

    if (dry) {
      const result = { dry: true as const, recipients: recipients.length, total: base.total, movers: base.movers.length, events: base.events.length }
      await record({ outcome: 'completed', detail: 'dry run', recipients: recipients.length })
      return result
    }

    if (force) {
      const match = allRecipients.find(r => r.email.toLowerCase() === forceEmail.toLowerCase())
      const rows = digestInterestRows(match?.interests ?? ALL_CATEGORIES, base.values)
      const ok = await withTimeout(
        sendWeeklyDigest({ email: forceEmail, token: match?.token ?? 'u:test' }, base, rows),
        SEND_TIMEOUT_MS,
        'weekly digest test send',
      )
      const result = {
        forced: true as const,
        email: forceEmail,
        sent: ok,
        recipientResolved: !!match,
        frequency: match?.frequency ?? null,
        emailEnabled: match?.emailEnabled ?? null,
      }
      await record({ outcome: ok ? 'completed' : 'failed', detail: 'forced test send', sent: ok ? 1 : 0, failed: ok ? 0 : 1 })
      return result
    }

    const week = isoWeekFromDateParts(et)
    const results = await Promise.allSettled(recipients.map(async r => {
      if (await withTimeout(weeklyDigestSent(week, r.email), REDIS_TIMEOUT_MS, 'weekly digest dedup read')) return 'skipped' as const
      const rows = digestInterestRows(r.interests ?? ALL_CATEGORIES, base.values)
      const ok = await withTimeout(
        sendWeeklyDigest({ email: r.email, token: r.token }, base, rows),
        SEND_TIMEOUT_MS,
        'weekly digest send',
      )
      if (!ok) return 'failed' as const
      await withTimeout(markWeeklyDigestSent(week, r.email), REDIS_TIMEOUT_MS, 'weekly digest dedup write')
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

    const result = { week, recipients: recipients.length, sent, skipped, failed, at: new Date().toISOString() }
    await record({
      outcome: failed > 0 ? 'failed' : 'completed',
      detail: week,
      recipients: recipients.length,
      sent,
      skipped,
      failed,
    })
    return result
  } catch (err) {
    await record({ outcome: 'failed', detail: err instanceof Error ? err.message : String(err), failed: 1 })
    throw err
  }
}
