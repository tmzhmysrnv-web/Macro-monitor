// lib/sendAlert.ts
// Email delivery via Resend: a welcome email on signup and the alert digest —
// the product's payoff, designed to be self-contained (you shouldn't need to
// open the site). No double opt-in. SMS removed. Every send no-ops without
// RESEND_API_KEY, so the flow stays safe before email is configured.

import type { FiredAlert, SectionTone } from './alertEngine'
import { barFor, nextFor, type AlertBar } from './alertMeta'
import { TONE_EMAIL } from './statusLadder'
import type { DigestBase, DigestInterestRow } from './weeklyDigest'

// Customer-facing emails must always use the branded domain — never a
// *.vercel.app deployment URL, even if SITE_URL is misconfigured to one.
const CANONICAL_URL = 'https://istheworldbreaking.com'
const site = () => {
  const s = (process.env.SITE_URL || '').replace(/\/$/, '')
  return s && !/\.vercel\.app$/i.test(s) ? s : CANONICAL_URL
}
const FROM = () => process.env.ALERT_EMAIL_FROM || 'alerts@istheworldbreaking.com'

async function client() {
  if (!process.env.RESEND_API_KEY) return null
  const { Resend } = await import('resend')
  return new Resend(process.env.RESEND_API_KEY)
}

const shell = (inner: string) => `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:540px;margin:0 auto;color:#1A1A18">
    ${inner}
  </div>
`

// ── Welcome email (single-step signup) ────────────────────────────────
export async function sendWelcomeEmail(email: string, token: string): Promise<boolean> {
  const r = await client()
  if (!r) { console.warn('sendWelcomeEmail: RESEND_API_KEY not set — skipping send'); return false }
  const unsub = `${site()}/api/unsubscribe?token=${token}`
  const p = 'margin:0 0 14px;font-size:15px;line-height:1.65;color:#1A1A18'
  const dim = 'margin:0 0 14px;font-size:15px;line-height:1.65;color:#6B6B67'
  const tight = 'margin:0 0 2px;font-size:15px;line-height:1.5;color:#6B6B67'
  const html = shell(`
    <p style="${p}">The news is designed to make everything feel urgent.</p>
    <p style="margin:0 0 22px;font-size:18px;font-weight:500;line-height:1.5;color:#1A1A18">Most of it isn't.</p>
    <p style="${dim}">You've subscribed at <strong style="color:#1A1A18">IsTheWorldBreaking.com</strong>.</p>
    <p style="${dim}">We monitor the indicators that actually matter — labor, inflation, credit, housing, markets, bonds, and global conditions — and watch for meaningful changes beneath the headlines.</p>
    <p style="${dim}">You don't need to follow every market move or breaking-news alert.</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;font-weight:500;color:#1A1A18">Go enjoy your life. We'll let you know when something actually breaks.</p>
    <p style="${dim}">You'll only receive alerts when an important indicator crosses a threshold worth paying attention to.</p>
    <div style="margin:0 0 22px">
      <p style="${tight}">No daily newsletters.</p>
      <p style="${tight}">No constant notifications.</p>
      <p style="${tight}">No noise.</p>
      <p style="margin:6px 0 0;font-size:15px;font-weight:500;color:#1A1A18">Only the signals that matter.</p>
    </div>
    <p style="color:#9E9E9A;font-size:12px;line-height:1.6;margin:22px 0 0;border-top:1px solid #eee;padding-top:14px">
      If you didn't request these alerts, <a href="${unsub}" style="color:#9E9E9A">click here to unsubscribe</a>.
    </p>
  `)
  try {
    const { error } = await r.emails.send({ from: FROM(), to: email, subject: 'Welcome to is the world breaking', html })
    if (error) { console.error('Resend rejected welcome email:', error); return false }
    return true
  } catch (e) {
    console.error('Resend welcome send threw:', e)
    return false
  }
}

// ── Weekly digest (calm Sunday recap) ─────────────────────────────────
const PILL: Record<'ok' | 'warn' | 'alert', { bg: string; fg: string }> = {
  ok:    { bg: '#E7F2EB', fg: '#235E40' },
  warn:  { bg: '#FBF3E6', fg: '#854F0B' },
  alert: { bg: '#FBECEA', fg: '#A3332E' },
}

export async function sendWeeklyDigest(
  recipient: { email: string; token: string },
  base: DigestBase,
  rows: DigestInterestRow[],
): Promise<boolean> {
  const r = await client()
  if (!r) { console.warn('sendWeeklyDigest: RESEND_API_KEY not set — skipping send'); return false }

  const dateLabel = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })
  const unsub = `${site()}/api/unsubscribe?token=${recipient.token}`
  const dash = `${site()}/dashboard`
  const settings = `${site()}/settings`
  const tone = TONE_EMAIL[base.tone]
  const kicker = 'font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#8B928C'

  const changeColor = base.change.dir === 'better' ? '#235E40' : base.change.dir === 'worse' ? tone.text : '#8B928C'

  const watchlist = rows.length === 0
    ? `<div style="border:1px solid #EEF0EC;border-radius:11px;padding:12px 14px;font-size:13px;color:#59615B;line-height:1.5">
         You haven't picked any topics yet. <a href="${site()}/watchlist" style="color:#235E40">Choose your interests</a> to fill your digest.
       </div>`
    : rows.map(row => {
        const p = PILL[row.status]
        return `<div style="border:1px solid #EEF0EC;border-radius:11px;padding:11px 13px;margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:14px;font-weight:500;color:#1E2622">${row.label}</span>
            <span style="font-size:11px;font-weight:500;padding:2px 9px;border-radius:999px;background:${p.bg};color:${p.fg}">${row.badge}</span>
          </div>
          <div style="font-size:12.5px;color:#59615B;margin-top:6px;line-height:1.5">${row.insight}</div>
        </div>`
      }).join('')

  const movers = base.movers.length === 0
    ? `<div style="font-size:13px;color:#59615B">All quiet — nothing moved meaningfully this week.</div>`
    : base.movers.map(m => {
        const c = m.dir === 'better' ? '#235E40' : m.dir === 'worse' ? tone.text : '#8B928C'
        const arrow = m.pct >= 0 ? '&#8593;' : '&#8595;'
        return `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span style="color:#1E2622">${m.label}</span>
          <span style="color:${c}">${arrow} ${m.pct >= 0 ? '+' : ''}${m.pct}%</span>
        </div>`
      }).join('')

  const moversNote = base.movers.length > 0 && base.tone === 'calm'
    ? `<div style="font-size:12px;color:#8B928C;margin-top:10px;border-top:1px solid #EEF0EC;padding-top:9px">None of these are large enough to change the overall outlook.</div>`
    : ''

  const nextWeek = base.events.length === 0 ? '' : `
    <div style="padding:12px 0">
      <div style="${kicker};margin-bottom:4px">Next week to watch</div>
      <div style="font-size:12px;color:#8B928C;margin-bottom:10px">Upcoming events that could influence next week's outlook.</div>
      ${base.events.map(e => `<div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:9px">
        <span style="color:#1E2622">${e.name}</span><span style="color:#59615B">${e.weekday}</span></div>`).join('')}
    </div>`

  const html = `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:540px;margin:0 auto;background:#FFFFFF;border:1px solid #E8E9E4;border-radius:14px;overflow:hidden;color:#1E2622">
    <div style="padding:18px 22px;border-bottom:1px solid #EEF0EC">
      <div style="font-family:'Space Mono',monospace;font-size:13px;color:#25734C;letter-spacing:.04em">is the world breaking?...</div>
      <div style="font-size:12px;color:#8B928C;margin-top:3px">Your week in review · ${dateLabel}</div>
    </div>

    <div style="padding:18px 22px">
      <div style="${kicker}">Current status</div>
      <div style="font-size:18px;font-weight:500;color:${tone.text};margin:2px 0">${base.headline}</div>
      <div style="font-size:14px;color:#1E2622">World stress: <strong>${base.total}</strong>/100</div>
      <div style="font-size:13px;color:${changeColor};margin-top:3px">${base.change.arrow} ${base.change.text}</div>
    </div>

    <div style="padding:0 22px 8px">
      <div style="${kicker};margin-bottom:10px">Your watchlist</div>
      ${watchlist}
    </div>

    <div style="padding:12px 22px">
      <div style="${kicker};margin-bottom:10px">What actually moved this week</div>
      ${movers}
      ${moversNote}
    </div>

    <div style="padding:0 22px">${nextWeek}</div>

    <div style="margin:6px 22px 18px;background:#EEF5EF;border:1px solid #DCEAE0;border-radius:12px;padding:14px">
      <div style="${kicker}">Bottom line</div>
      <div style="font-size:16px;font-weight:500;color:${tone.text};margin:2px 0">${base.bottom.h}</div>
      <div style="font-size:13px;color:#59615B;line-height:1.5">${base.bottom.text}</div>
    </div>

    <div style="padding:14px 22px;border-top:1px solid #EEF0EC;text-align:center">
      <a href="${dash}" style="display:inline-block;font-size:13px;font-weight:500;color:#fff;background:#2F9160;border-radius:9px;padding:9px 18px;text-decoration:none">View Full Dashboard</a>
      <div style="font-size:11px;color:#A0A6A1;margin-top:12px">
        <a href="${settings}" style="color:#A0A6A1">Manage preferences</a> · <a href="${unsub}" style="color:#A0A6A1">Unsubscribe from the weekly digest</a>
      </div>
    </div>
  </div>`

  try {
    const { error } = await r.emails.send({ from: FROM(), to: recipient.email, subject: `Your week in review · ${dateLabel}`, html })
    if (error) { console.error('Resend rejected weekly digest:', error); return false }
    return true
  } catch (e) {
    console.error('Resend weekly digest threw:', e)
    return false
  }
}

// ── Alert digest building blocks ──────────────────────────────────────
type Tier = { label: string; text: string; bg: string; border: string }
function tierStyle(sev: number): Tier {
  if (sev >= 3) return { label: 'Critical', text: '#A32D2D', bg: '#FCEBEB', border: '#E24B4A' }
  if (sev === 1) return { label: 'Update', text: '#3B6D11', bg: '#EAF3DE', border: '#97C459' }
  return { label: 'Alert', text: '#854F0B', bg: '#FAEEDA', border: '#EF9F27' }
}

const TONE_RANK: Record<string, number> = { crisis: 5, bad: 4, warn: 3, neutral: 2, good: 1, unknown: 0 }
// Mirror the per-tab TONE_COLORS scale exactly (neutral is yellow, not green)
// so the email's status row agrees with each tab and the in-app monitor.
function toneColor(tone: string): string {
  if (tone === 'crisis') return '#A32D2D'
  if (tone === 'bad') return '#E24B4A'
  if (tone === 'warn') return '#BA7517'
  if (tone === 'neutral') return '#9E9E2E'
  if (tone === 'good') return '#639922'
  return '#C9C7BF'
}

function fmtNum(v: number, unit: string): string {
  const r = v >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString()
  switch (unit) {
    case '$': return `$${v >= 100 ? Math.round(v) : r}`
    case '%': return `${r}%`
    case 'k': return `${r}k`
    case 'bp': return `${r}bp`
    case 'pp': return `${r}pp`
    case 'M': return `${r}M`
    case 'mo': return `${r} mo`
    default: return r
  }
}

function barHtml(bar: AlertBar, color: string): string {
  const scale = Math.max(bar.value, bar.threshold) * 1.4 || 1
  const vPct = Math.max(3, Math.min(100, Math.round(bar.value / scale * 100)))
  const arrow = bar.dir === 'above' ? '↑' : '↓'
  return `
    <table width="100%" style="border-collapse:collapse;margin:6px 0 16px"><tr>
      <td style="vertical-align:bottom;padding-right:16px;white-space:nowrap">
        <div style="font-size:11px;color:#9E9E9A;font-family:monospace">now</div>
        <div style="font-size:24px;font-weight:600;color:${color};font-family:monospace;line-height:1.1">${fmtNum(bar.value, bar.unit)}</div>
      </td>
      <td style="vertical-align:bottom;width:99%">
        <div style="font-size:11px;color:#9E9E9A;font-family:monospace;text-align:right;margin-bottom:5px">threshold ${fmtNum(bar.threshold, bar.unit)}</div>
        <div style="height:6px;background:#EFEDE8;border-radius:3px;overflow:hidden">
          <table width="100%" style="border-collapse:collapse"><tr><td style="height:6px;background:${color};width:${vPct}%"></td><td style="height:6px"></td></tr></table>
        </div>
        <div style="font-size:11px;color:${color};font-family:monospace;text-align:right;margin-top:5px">${arrow} past the line</div>
      </td>
    </tr></table>`
}

function affectedHtml(areas: string[]): string {
  if (!areas.length) return ''
  const chips = areas.map(a => `<span style="display:inline-block;font-size:12px;color:#6B6B67;background:#F3F1EC;padding:3px 9px;border-radius:6px;margin:0 5px 5px 0">${a}</span>`).join('')
  return `
    <div style="margin:14px 0 0">
      <div style="font-size:11px;color:#9E9E9A;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:7px;font-family:monospace">areas affected</div>
      <div>${chips}</div>
    </div>`
}

function cardHtml(a: FiredAlert): string {
  const tier = tierStyle(a.severity)
  const bar = barFor(a)
  const next = nextFor(a.id)
  return `
    <div style="border:1px solid #eee;border-left:3px solid ${tier.border};border-radius:6px;padding:16px 18px;margin:0 0 14px">
      <div style="display:inline-block;font-family:monospace;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:${tier.text};background:${tier.bg};padding:3px 9px;border-radius:5px;margin-bottom:12px">${tier.label} · ${a.tabLabel.toLowerCase()}</div>
      <div style="font-size:17px;font-weight:600;color:#1A1A18;line-height:1.35;margin-bottom:${bar ? '14px' : '12px'}">${a.title}</div>
      ${bar ? barHtml(bar, tier.border) : ''}
      <div style="font-size:14px;line-height:1.6;color:#6B6B67;margin-bottom:10px"><strong style="color:#1A1A18">What this means — </strong>${a.what}</div>
      <div style="font-size:14px;line-height:1.6;color:#6B6B67"><strong style="color:#1A1A18">Why it matters — </strong>${a.why}</div>
      ${affectedHtml(a.affected)}
      ${a.context ? `<div style="font-size:12.5px;line-height:1.55;color:#9E9E9A;margin-top:14px;padding-top:13px;border-top:1px solid #eee"><strong style="color:#6B6B67">Historically — </strong>${a.context}</div>` : ''}
      ${next ? `<div style="font-size:12.5px;line-height:1.55;color:#9E9E9A;margin-top:6px"><strong style="color:#6B6B67">Watching next — </strong>${next}</div>` : ''}
      <a href="${site()}/?tab=${a.tab}" style="display:inline-block;margin-top:13px;font-size:13px;font-weight:600;color:${tier.text};text-decoration:none">View the full ${a.tabLabel.toLowerCase()} breakdown →</a>
    </div>`
}

function gaugeHtml(n: number | null): string {
  if (n == null) return ''
  const info = n < 25 ? { w: 'calm', c: '#639922' } : n < 45 ? { w: 'guarded', c: '#BA7517' }
    : n < 65 ? { w: 'elevated', c: '#BA7517' } : n < 85 ? { w: 'high', c: '#E24B4A' } : { w: 'severe', c: '#E24B4A' }
  const pct = Math.max(3, Math.min(100, Math.round(n)))
  return `
    <table width="100%" style="border-collapse:collapse;margin:0 0 20px"><tr>
      <td style="width:99%;padding-right:14px">
        <div style="height:5px;background:#EFEDE8;border-radius:3px;overflow:hidden">
          <table width="100%" style="border-collapse:collapse"><tr><td style="height:5px;background:${info.c};width:${pct}%"></td><td style="height:5px"></td></tr></table>
        </div>
      </td>
      <td style="white-space:nowrap;font-size:12px;color:#6B6B67;font-family:monospace">break level ${Math.round(n)} · ${info.w}</td>
    </tr></table>`
}

function statusRowHtml(sections: SectionTone[]): string {
  if (!sections.length) return ''
  const ranked = [...sections].sort((a, b) => (TONE_RANK[b.tone] ?? 0) - (TONE_RANK[a.tone] ?? 0))
  const items = ranked.map(s =>
    `<a href="${site()}/?tab=${s.tab}" style="text-decoration:none;color:#6B6B67;font-size:12px;font-family:monospace;display:inline-block;margin:0 16px 8px 0;white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${toneColor(s.tone)};margin-right:6px"></span>${s.tabLabel.toLowerCase()}</a>`
  ).join('')
  return `<div style="margin:0 0 22px;padding:14px 0;border-top:1px solid #eee;border-bottom:1px solid #eee">${items}</div>`
}

function mastheadHtml(): string {
  const now = new Date()
  const d = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
  const t = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  return `
    <table width="100%" style="border-collapse:collapse;margin:0 0 20px"><tr>
      <td style="font-family:monospace;font-size:13px;letter-spacing:0.04em;color:#6b9576">is the world breaking?</td>
      <td style="text-align:right;font-family:monospace;font-size:12px;color:#9E9E9A">${d} · ${t} ET</td>
    </tr></table>`
}

export type DigestContext = { breakLevel: number | null; sections: SectionTone[] }

export async function sendDigest(alerts: FiredAlert[], recipient: { email: string; token: string }, ctx: DigestContext): Promise<boolean> {
  const r = await client(); if (!r || alerts.length === 0) return false
  const unsub = `${site()}/api/unsubscribe?token=${recipient.token}`
  const n = alerts.length
  const heading = n === 1 ? 'One indicator crossed its line today.' : `${n} indicators crossed their lines today.`
  const subject = n === 1 ? alerts[0].title : `${n} indicators crossed their thresholds`
  const movers = Array.from(new Set(alerts.slice(0, 3).map(a => a.tabLabel.toLowerCase()))).join(', ')

  const html = shell(`
    <span style="display:none;max-height:0;overflow:hidden;opacity:0">${movers} moved — here's what it means and whether to worry.</span>
    ${mastheadHtml()}
    <div style="font-size:20px;font-weight:600;color:#1A1A18;line-height:1.4;margin:0 0 14px">${heading}</div>
    ${gaugeHtml(ctx.breakLevel)}
    ${statusRowHtml(ctx.sections)}
    ${alerts.map(cardHtml).join('')}
    <div style="font-size:15px;color:#1A1A18;line-height:1.6;margin:8px 0 16px">We'll keep watching. You don't have to.</div>
    <a href="${site()}" style="display:inline-block;background:#1A1A18;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 22px;border-radius:8px">See the full picture →</a>
    <p style="font-size:11px;color:#9E9E9A;line-height:1.6;margin:24px 0 0;border-top:1px solid #eee;padding-top:12px">
      You're getting this because you signed up at IsTheWorldBreaking.com.
      <a href="${unsub}" style="color:#9E9E9A">Unsubscribe</a>. · Informational only — not financial advice.
    </p>
  `)

  await r.emails.send({ from: FROM(), to: recipient.email, subject, html })
  return true
}
