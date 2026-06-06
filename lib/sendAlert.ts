// lib/sendAlert.ts
// Sends email + SMS alerts when thresholds are breached

export type AlertPayload = {
  indicator: string
  value: number
  threshold: number
  direction: 'above' | 'below'
  unit: string
}

function formatMessage(alert: AlertPayload): string {
  const dir = alert.direction === 'above' ? '↑' : '↓'
  return `${dir} MACRO ALERT: ${alert.indicator} is ${alert.value}${alert.unit} — ${alert.direction} threshold of ${alert.threshold}${alert.unit}`
}

export async function sendEmailAlert(alerts: AlertPayload[]): Promise<void> {
  if (!process.env.RESEND_API_KEY || alerts.length === 0) return

  const lines = alerts.map(a => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:500">${a.indicator}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#A32D2D">${a.value}${a.unit}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${a.direction} ${a.threshold}${a.unit}</td>
    </tr>
  `).join('')

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="font-size:18px;font-weight:500;margin-bottom:4px">Macro Monitor Alert</h2>
      <p style="color:#666;font-size:13px;margin-bottom:16px">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:8px 12px;text-align:left;font-weight:500">Indicator</th>
            <th style="padding:8px 12px;text-align:left;font-weight:500">Value</th>
            <th style="padding:8px 12px;text-align:left;font-weight:500">Threshold</th>
          </tr>
        </thead>
        <tbody>${lines}</tbody>
      </table>
      <p style="font-size:12px;color:#999;margin-top:16px">
        View dashboard → <a href="${process.env.SITE_URL || 'https://your-site.vercel.app'}">macromonitor</a>
      </p>
    </div>
  `

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from: process.env.ALERT_EMAIL_FROM || 'alerts@yourdomain.com',
    to: process.env.ALERT_EMAIL_TO || '',
    subject: `🚨 Macro Alert: ${alerts.map(a => a.indicator).join(', ')}`,
    html,
  })
}

export async function sendSmsAlert(alerts: AlertPayload[]): Promise<void> {
  if (!process.env.TWILIO_ACCOUNT_SID || alerts.length === 0) return

  const twilio = (await import('twilio')).default
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

  const body = alerts.map(a => formatMessage(a)).join('\n')

  await client.messages.create({
    body: `Macro Monitor\n${body}\n${process.env.SITE_URL || ''}`,
    from: process.env.TWILIO_FROM_NUMBER || '',
    to: process.env.ALERT_SMS_TO || '',
  })
}

export async function sendAllAlerts(alerts: AlertPayload[]): Promise<void> {
  if (alerts.length === 0) return
  await Promise.allSettled([
    sendEmailAlert(alerts),
    sendSmsAlert(alerts),
  ])
}
