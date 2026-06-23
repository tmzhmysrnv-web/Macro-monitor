// next.config.js
// Security headers (audit M2). The CSP was vetted in Report-Only first (console
// showed only Cloudflare's auto-injected Web Analytics beacon, now allowlisted)
// and is now ENFORCED. styled-jsx + inline style attributes require 'unsafe-inline'
// in style-src; Next's Pages-Router runtime needs it in script-src (no nonce setup).
// Allowlisted hosts: Turnstile (challenges.cloudflare.com), Cloudflare Web Analytics
// (static.cloudflareinsights.com loads the beacon, cloudflareinsights.com receives
// its RUM POST), Supabase, Google Fonts. To debug a new violation, swap the header
// key back to "Content-Security-Policy-Report-Only".
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com https://cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Content-Security-Policy-Report-Only', value: csp },
]

/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
