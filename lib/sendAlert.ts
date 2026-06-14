// lib/sendAlert.ts
// Email delivery via Resend: a welcome email on signup and the alert digest.
// No double opt-in — subscribing activates immediately. SMS was removed. Every
// send is a no-op when RESEND_API_KEY is absent, so the flow stays safe before
// email is configured.

import type { FiredAlert } from './alertEngine'
import { TIERS, type Severity } from './alertSeverity'

const site = () => (process.env.SITE_URL || 'https://istheworldbreaking.com').replace(/\/$/, '')
const FROM = () => process.env.ALERT_EMAIL_FROM || 'alerts@istheworldbreaking.com'

async function client() {
  if (!process.env.RESEND_API_KEY) return null
  const { Resend } = await import('resend')
  return new Resend(process.env.RESEND_API_KEY)
}

const shell = (inner: string) => `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#1A1A18">
    ${inner}
  </div>
`

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
    <p style="${dim}">You've subscribed to Macro Monitor from <strong style="color:#1A1A18">IsTheWorldBreaking.com</strong>.</p>
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

// Full alert "cards" — bordered, tier-colored, with what/why and a link back.
function alertCards(alerts: FiredAlert[]): string {
  return alerts.map(a => {
    const tier = TIERS[a.severity as Severity]
    return `
      <div style="border:1px solid #eee;border-left:3px solid ${tier.color};border-radius:8px;padding:14px 16px;margin:0 0 12px">
        <div style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${tier.color};background:${tier.bg};padding:2px 7px;border-radius:4px">${tier.label} · ${a.tabLabel}</div>
        <div style="font-size:16px;font-weight:600;margin:8px 0 8px;color:#1A1A18">${a.title}</div>
        <div style="font-size:13px;color:#6B6B67;line-height:1.55;margin-bottom:7px"><strong style="color:#1A1A18">What's happening — </strong>${a.what}</div>
        <div style="font-size:13px;color:#6B6B67;line-height:1.55"><strong style="color:#1A1A18">Why it matters — </strong>${a.why}</div>
        <a href="${site()}" style="display:inline-block;margin-top:11px;font-size:12px;font-weight:600;color:${tier.color};text-decoration:none">View on IsTheWorldBreaking.com →</a>
      </div>`
  }).join('')
}

export async function sendDigest(alerts: FiredAlert[], recipient: { email: string; token: string }): Promise<boolean> {
  const r = await client(); if (!r || alerts.length === 0) return false
  const unsub = `${site()}/api/unsubscribe?token=${recipient.token}`
  const lead = alerts.slice(0, 2).map(a => a.title).join(', ') + (alerts.length > 2 ? '…' : '')
  const heading = alerts.length === 1 ? '1 macro alert' : `${alerts.length} macro alerts`

  const html = shell(`
    <p style="font-size:12px;color:#9E9E9A;margin:0 0 4px">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET</p>
    <h2 style="font-size:18px;font-weight:500;margin:0 0 16px">${heading}</h2>
    ${alertCards(alerts)}
    <a href="${site()}" style="display:inline-block;margin-top:6px;background:#1A1A18;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 22px;border-radius:8px">Open the dashboard →</a>
    <p style="font-size:11px;color:#9E9E9A;line-height:1.6;margin:24px 0 0;border-top:1px solid #eee;padding-top:12px">
      You're getting this because you subscribed to Macro Monitor alerts.
      <a href="${unsub}" style="color:#9E9E9A">Unsubscribe</a>.
    </p>
  `)

  await r.emails.send({ from: FROM(), to: recipient.email, subject: `🔔 ${heading}: ${lead}`, html })
  return true
}
