// lib/support.ts
// Single source for support/donation links so providers can be swapped later
// (Ko-fi today; could become Buy Me a Coffee / Patreon / Stripe). Support is
// always optional — never gate features behind these.
export const SUPPORT_LINKS = {
  oneTime: 'https://ko-fi.com/istheworldbreaking',
  monthly: 'https://ko-fi.com/istheworldbreaking/tiers',
}
