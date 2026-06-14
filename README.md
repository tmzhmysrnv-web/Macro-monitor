# Macro Monitor

A calm macro dashboard. Shows the state of key economic indicators at a glance. Sends email + in-app alerts only when thresholds are breached — no noise otherwise.

---

## Indicators tracked

| Indicator | Alert trigger |
|---|---|
| VIX | > 35 |
| 10Y Treasury | > 5.5% |
| Fed Funds Rate | on any change |
| CPI (YoY) | > 4% |
| Jobless Claims | > 280k |
| 2Y–10Y Yield Curve | < –0.5% (deep inversion) |
| HY Bond Spread | > 6% |
| S&P 500 | –10% drawdown |

Edit thresholds in `lib/thresholds.ts`.

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/macro-monitor.git
cd macro-monitor
npm install
```

### 2. Get your API keys

**FRED API (free, required)**
1. Go to https://fred.stlouisfed.org/docs/api/api_key.html
2. Create a free account → request an API key
3. Takes 1–2 minutes

**Resend (free, for email alerts)**
1. Go to https://resend.com → sign up free
2. Create an API key
3. Add and verify your sending domain (or use their sandbox for testing)

**Upstash Redis (free, required for email + in-app feed)**
1. Easiest: Vercel → Storage → Upstash Redis (one click; sets the two env vars automatically)
2. Or sign up at https://upstash.com → create a Redis database → copy the REST URL + token
3. Stores subscribers, alert dedup state, and the in-app notification feed

### 3. Set environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:
```
FRED_API_KEY=your_key
RESEND_API_KEY=your_key
ALERT_EMAIL_FROM=alerts@yourdomain.com
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_rest_token
CRON_SECRET=make_up_any_random_string
SITE_URL=https://your-app.vercel.app
```

Subscribers manage themselves: anyone can sign up from the in-app bell, confirm
via a double-opt-in email, and unsubscribe from any alert. There's no single
recipient env var anymore.

### 4. Run locally

```bash
npm run dev
```

Open http://localhost:3000

---

## Deploy to Vercel (free)

### First deploy

1. Push to GitHub:
```bash
git init
git add .
git commit -m "initial"
gh repo create macro-monitor --public --push
```

2. Go to https://vercel.com → New Project → import your repo

3. Add all environment variables from `.env.example` in the Vercel dashboard
   (Settings → Environment Variables)

4. Deploy — Vercel auto-detects Next.js

Your site will be live at `https://macro-monitor.vercel.app`

### Cron job

`vercel.json` configures a cron to run `/api/cron` once a day automatically.
It checks every intelligence-tab alert, emails subscribers about anything new or
escalated, and updates the in-app feed. Add `CRON_SECRET` as an env var in Vercel
— it matches the secret in your `.env.local`.

### Custom domain (optional)

1. Buy a domain on Namecheap (~$10/yr) or Cloudflare Registrar
2. In Vercel → Settings → Domains → Add your domain
3. Follow the DNS instructions (takes 5–10 min to propagate)

---

## Customizing thresholds

Open `lib/thresholds.ts` and edit the `alertAbove` / `alertBelow` values.
Changes deploy automatically when you push to GitHub.

---

## Cost summary

| Service | Cost |
|---|---|
| Vercel hosting | Free |
| FRED API | Free |
| Yahoo Finance | Free |
| Resend email | Free (3k/mo) |
| Upstash Redis | Free (10k cmd/day) |
| Domain (optional) | ~$10/yr |

**Total: $0/month (plus an optional domain)**
