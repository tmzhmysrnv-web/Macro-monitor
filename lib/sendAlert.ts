// lib/sendAlert.ts
// Email delivery via Resend: the double-opt-in confirmation email and the alert
// digest. SMS was removed. Every send is a no-op when RESEND_API_KEY is absent,
// so the cron and subscribe flow stay safe before email is configured.

import type { FiredAlert } from './alertEngine'
import { TIERS, type Severity } from './alertSeverity'

const site = () => (process.env.SITE_URL || 'https://macromonitor.vercel.app').replace(/\/$/, '')
const FROM = () => process.env.ALERT_EMAIL_FROM || 'alerts@macromonitor.app'

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

export async function sendConfirmationEmail(email: string, token: string): Promise<boolean> {
  const r = await client(); if (!r) return false
  const url = `${site()}/api/confirm?token=${token}`
  const html = shell(`
    <h2 style="font-size:18px;font-weight:500;margin:0 0 8px">Confirm your macro alerts</h2>
    <p style="color:#6B6B67;font-size:14px;line-height:1.6;margin:0 0 20px">
      You asked to get an email whenever a macro indicator breaks its threshold — the kind of move that actually matters.
      Confirm below and we'll only reach out when something does.
    </p>
    <a href="${url}" style="display:inline-block;background:#1A1A18;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px">Confirm subscription</a>
    <p style="color:#9E9E9A;font-size:12px;line-height:1.6;margin:20px 0 0">
      If you didn't request this, just ignore this email — you won't be subscribed.
    </p>
  `)
  await r.emails.send({ from: FROM(), to: email, subject: 'Confirm your Macro Monitor alerts', html })
  return true
}

function alertRows(alerts: FiredAlert[]): string {
  return alerts.map(a => {
    const tier = TIERS[a.severity as Severity]
    return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #eee;vertical-align:top">
          <div style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${tier.color};background:${tier.bg};padding:2px 7px;border-radius:4px;margin-bottom:6px">${tier.label} · ${a.tabLabel}</div>
          <div style="font-size:15px;font-weight:500;margin-bottom:3px">${a.title}</div>
          <div style="font-size:13px;color:#6B6B67;line-height:1.55">${a.what}</div>
          <div style="font-size:12px;color:#9E9E9A;line-height:1.55;margin-top:4px">${a.why}</div>
        </td>
      </tr>`
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
    <table style="width:100%;border-collapse:collapse">${alertRows(alerts)}</table>
    <a href="${site()}" style="display:inline-block;margin-top:18px;font-size:13px;color:#1A1A18;font-weight:500;text-decoration:none">Open the dashboard →</a>
    <p style="font-size:11px;color:#9E9E9A;line-height:1.6;margin:24px 0 0;border-top:1px solid #eee;padding-top:12px">
      You're getting this because you subscribed to Macro Monitor alerts.
      <a href="${unsub}" style="color:#9E9E9A">Unsubscribe</a>.
    </p>
  `)

  await r.emails.send({ from: FROM(), to: recipient.email, subject: `🔔 ${heading}: ${lead}`, html })
  return true
}
