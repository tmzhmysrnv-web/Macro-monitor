// pages/dashboard.tsx — the personalized, login-only dashboard.
// A calm "current status" header, the user's watchlist of interest cards, the
// week's biggest movers, and a reassuring bottom line. All numbers come from the
// existing public macro APIs; the page just filters to the user's interests.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppShell from '../components/app/AppShell'
import InterestCard from '../components/app/InterestCard'
import SupportCard from '../components/app/SupportCard'
import Icon from '../components/Icon'
import { loadGatedProps, type GatedProps } from '../lib/supabase/server'
import { INTEREST_CATALOG, readInterest } from '../lib/interests'
import { toneFor, bottomLine, TONE_TEXT, TONE_BADGE } from '../lib/statusLadder'
import { fetchEvents, recentAndUpcoming, type EconomicEvent } from '../lib/economicCalendar'
import { getSupabaseBrowser } from '../lib/supabase/client'
import ComingUp from '../components/ComingUp'
import { getCachedBundle, type Bundle } from '../lib/bundle'

type Vals = Record<string, number | null>
type StressPt = { date: string; total: number }
type Mover = { key: string; label: string; current: number; weekAgo: number; unit: string; direction: string }
type Concern = { label: string; detail: string; tab: string } | null
type Briefing = { headline: string; concern: Concern; stabilizer: Concern } | null

type Payload = {
  total: number; level: string; verdict: string; weekChange: number | null
  briefing: Briefing
  whatChanged: Mover[]; history: StressPt[]; values: Vals; series: Record<string, number[]>
}
type HistoryBatch = { series?: Record<string, { value: number }[]> }

// Status ladder (tone, headline, bottom-line copy, colors) lives in
// lib/statusLadder.ts — shared with /digest and the weekly digest email.
function deltaLabel(d: number): string {
  const a = Math.abs(d)
  return a < 3 ? 'insignificant' : a < 8 ? 'minor' : 'notable'
}
function moveText(m: Mover): { word: string; pct: string } {
  const pct = m.weekAgo ? ((m.current - m.weekAgo) / Math.abs(m.weekAgo)) * 100 : 0
  return { word: m.current >= m.weekAgo ? 'Increased' : 'Declined', pct: `${Math.abs(pct).toFixed(1)}%` }
}

function StressTrend({ pts }: { pts: StressPt[] }) {
  if (!pts || pts.length < 2) return null
  const data = pts.slice(-40)
  const W = 320, H = 88, P = 6
  const vals = data.map(p => p.total)
  const min = Math.min(...vals, 0), max = Math.max(...vals, 100), range = max - min || 1
  const x = (i: number) => P + (i / (data.length - 1)) * (W - 2 * P)
  const y = (v: number) => P + (H - 2 * P) - ((v - min) / range) * (H - 2 * P)
  const line = data.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`)
  const area = `${line.join(' ')} ${x(data.length - 1).toFixed(1)},${(H - P).toFixed(1)} ${x(0).toFixed(1)},${(H - P).toFixed(1)}`
  const last = data[data.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} fill="var(--c-green)" opacity="0.08" />
      <polyline points={line.join(' ')} fill="none" stroke="var(--c-green)" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={x(data.length - 1)} cy={y(last.total)} r="3.5" fill="var(--c-green)" />
    </svg>
  )
}

export default function DashboardPage(props: GatedProps & { initial: Bundle }) {
  const router = useRouter()
  // Seed the Current Status, score, bottom line, and watchlist from data fetched
  // server-side (getServerSideProps -> buildBundle) so the dashboard paints
  // complete on arrival; the client effect below refreshes + fills sparklines.
  const seed = props.initial
  const bm0 = seed?.breakmeter
  const [d, setD] = useState<Payload | null>(bm0 ? ({
    total: Math.round(bm0.total ?? 0),
    level: bm0.level ?? 'calm',
    verdict: bm0.verdict ?? '',
    briefing: bm0.briefing ?? null,
    weekChange: bm0.weekChange ?? null,
    whatChanged: bm0.whatChanged ?? [],
    history: (bm0.recentTrend ?? []).map(p => ({ date: p.date, total: p.value })),
    values: (seed?.data ?? {}) as Vals,
    series: {},
  }) as Payload : null)
  const [events, setEvents] = useState<EconomicEvent[]>(seed?.events ?? [])
  const [err, setErr] = useState(false)
  const myInterests = INTEREST_CATALOG.filter(i => props.interests.includes(i.category))

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const leads = Array.from(new Set(myInterests.map(i => i.metrics[0])))
        // The SSR seed (getCachedBundle -> Redis, <=15min old) already carries the
        // score, Redis-backed weekChange, recentTrend, whatChanged and values, so on
        // a normal load we ONLY fetch the batched history sparklines the bundle
        // doesn't include. We refresh the core score/values from /api/* only when the
        // seed came back empty (Redis cold + a FRED blip at render time).
        const needCore = !bm0
        const historyUrl = leads.length
          ? `/api/history?keys=${encodeURIComponent(leads.join(','))}&mode=sparkline`
          : null
        const [bm, data, hist] = await Promise.all([
          needCore ? fetch('/api/breakmeter').then(r => r.json()) : Promise.resolve(null),
          needCore ? fetch('/api/data').then(r => r.json()) : Promise.resolve(null),
          historyUrl ? fetch(historyUrl).then(r => r.json()).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return
        const series: Record<string, number[]> = {}
        const batch = hist as HistoryBatch | null
        for (const [k, s] of Object.entries(batch?.series ?? {})) {
          if (s?.length) series[k] = s.map(p => p.value)
        }
        // Normal path: keep the complete seed, just attach the sparklines.
        if (!needCore) {
          setD(prev => (prev ? { ...prev, series } : prev))
          return
        }
        // Fallback path: seed was empty, fill the core from the live fetch.
        // Don't let a rate-limited refresh overwrite whatever we do have.
        const bmOk = bm && bm.available !== false
        setD(prev => ({
          total: bmOk ? Math.round(bm.total ?? 0) : (prev?.total ?? 0),
          level: bmOk ? (bm.level ?? 'calm') : (prev?.level ?? 'calm'),
          verdict: bmOk ? (bm.verdict ?? '') : (prev?.verdict ?? ''),
          briefing: bmOk ? (bm.briefing ?? null) : (prev?.briefing ?? null),
          weekChange: bmOk ? (bm.weekChange ?? null) : (prev?.weekChange ?? null),
          whatChanged: bmOk ? (bm.whatChanged ?? []) : (prev?.whatChanged ?? []),
          history: bmOk ? (bm.recentTrend ?? []).map((p: { date: string; value: number }) => ({ date: p.date, total: p.value })) : (prev?.history ?? []),
          values: bmOk ? data : (prev?.values ?? data),
          series,
        }))
      } catch { if (!cancelled) setErr(true) }
    }
    load()
    fetchEvents(getSupabaseBrowser()).then(e => { if (!cancelled) setEvents(recentAndUpcoming(e)) }).catch(() => {})
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const bl = d ? bottomLine(d.total) : null
  const tone = d ? toneFor(d.total) : 'calm'
  const movers = (d?.whatChanged ?? []).slice(0, 3)

  return (
    <AppShell user={props.user} active="/dashboard">
      <Head><title>Dashboard · Is the World Breaking?</title></Head>

      <div className="dh">
        <div>
          <h1 className="dh-title">Dashboard</h1>
          <p className="dh-sub">Your personalized view of what matters most.</p>
        </div>
        <button className="dh-refresh" onClick={() => router.reload()} title="Refresh" aria-label="Refresh"><Icon name="refresh" size={16} /></button>
      </div>

      {/* Current status */}
      <div className="calm-card soft cs">
        <div className="cs-left">
          <div className="cs-shield" style={{ background: TONE_BADGE[tone] }}><Icon name="shield-check" size={30} /></div>
          <div>
            <div className="cs-kicker">Current Status</div>
            <div className="cs-headline" style={d ? { color: TONE_TEXT[tone] } : undefined}>{d ? (d.briefing?.headline ?? d.verdict) : 'Checking…'}</div>
            <div className="cs-statussub">
              {d?.briefing?.concern
                ? <>Biggest concern: <b>{d.briefing.concern.label}</b>{d.briefing.concern.detail ? ` — ${d.briefing.concern.detail}` : ''}</>
                : (d ? 'Nothing pressing right now.' : 'Reading the latest data.')}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => router.push('/?tab=overview')}>
              View Details <Icon name="arrow-right" size={15} />
            </button>
          </div>
        </div>
        <div className="cs-right">
          <div className="cs-kicker">Break Meter</div>
          <div className="cs-score"><b>{d ? d.total : '—'}</b> / 100</div>
          {d && d.weekChange != null && (() => {
            const wc = Math.round(d.weekChange)
            const dir = wc > 0 ? 'up' : wc < 0 ? 'down' : 'flat'
            return (
              <div className="cs-week">
                Last week: {d.total - wc}
                <span className={`cs-delta ${dir}`}>
                  <Icon name={wc > 0 ? 'arrow-up' : wc < 0 ? 'arrow-down' : 'arrow-right'} size={12} />
                  {wc === 0 ? 'Unchanged' : `${wc > 0 ? '+' : ''}${wc} (${deltaLabel(d.weekChange)})`}
                </span>
              </div>
            )
          })()}
          <div className="cs-trend">{d && <StressTrend pts={d.history} />}</div>
        </div>
      </div>

      {/* Watchlist */}
      <div className="sec-head">
        <div>
          <h2 className="sec-title">Your Watchlist</h2>
          <p className="sec-sub">Based on the topics you care about.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => router.push('/watchlist')}><Icon name="edit" size={15} /> Edit Watchlist</button>
      </div>

      {myInterests.length === 0 ? (
        <div className="calm-card" style={{ textAlign: 'center', color: 'var(--c-text-soft)' }}>
          You haven't picked any topics yet. <button className="auth-switch" onClick={() => router.push('/watchlist')}>Choose your interests →</button>
        </div>
      ) : (
        <div className="wl-grid">
          {myInterests.map(def => {
            const reading = d ? readInterest(def, d.values) : { status: 'ok' as const, badge: '…', insight: 'Loading the latest readings…' }
            return (
              <InterestCard key={def.category} def={def} reading={reading}
                values={d?.values ?? {}} series={d?.series[def.metrics[0]]}
                onOpen={() => router.push(`/?tab=${def.tab}`)} />
            )
          })}
        </div>
      )}

      {/* What moved */}
      {movers.length > 0 && (
        <div className="calm-card moved">
          <h2 className="sec-title" style={{ marginBottom: 2 }}>What Actually Moved This Week</h2>
          <p className="sec-sub" style={{ marginBottom: 16 }}>The biggest changes we detected.</p>
          <div className="moved-grid">
            {movers.map(m => {
              const t = moveText(m)
              const danger = m.direction === 'toward-danger'
              const safe = m.direction === 'toward-safety'
              const up = m.current >= m.weekAgo
              return (
                <div key={m.key} className="moved-item">
                  <span className={`moved-arrow ${danger ? 'bad' : safe ? 'ok' : ''}`}>
                    <Icon name={up ? 'arrow-up' : 'arrow-down'} size={18} />
                  </span>
                  <div>
                    <div className="moved-label">{m.label}</div>
                    <div className={`moved-change ${danger ? 'bad' : safe ? 'ok' : ''}`}>{t.word} {t.pct}</div>
                    <div className="moved-tag">{danger ? 'Negative' : safe ? 'Positive' : 'Neutral'}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="moved-note"><Icon name="info-circle" size={15} /> None of these changes are large enough to alter the overall outlook.</div>
        </div>
      )}

      {/* Coming up — imminent economic releases (within 72h) */}
      <ComingUp events={events} theme="app" />

      {/* Bottom line */}
      {bl && (
        <div className="calm-card soft bottomline">
          <div className="bl-icon" style={{ background: TONE_BADGE[tone] }}><Icon name="sunrise" size={30} /></div>
          <div>
            <div className="cs-kicker">Bottom Line</div>
            <div className="bl-h" style={{ color: TONE_TEXT[tone] }}>{bl.h}</div>
            <div className="bl-m">{bl.lead}<span className="swap">{bl.swap}</span>{bl.tail}</div>
          </div>
        </div>
      )}

      {err && <div className="calm-card" style={{ color: 'var(--c-bad)' }}>Couldn't load the latest data. Try refreshing.</div>}

      {/* Support — calm, optional, after all primary content */}
      <SupportCard />

      <div className="dfoot">Questions or feedback? We're always here. <a href="mailto:hello@istheworldbreaking.com">Contact us</a></div>

      <style>{`
        .dh { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
        .dh-title { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; color: var(--c-shell-text); }
        .dh-sub { font-size: 14px; color: var(--c-shell-text-soft); margin-top: 3px; }
        .dh-refresh { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 10px; padding: 9px; cursor: pointer; color: var(--c-text-soft); }
        .dh-refresh:hover { color: var(--c-text); }
        .cs { display: grid; grid-template-columns: 1.3fr 1fr; gap: 24px; margin-bottom: 30px; }
        .cs-left { display: flex; gap: 16px; }
        .cs-shield { width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--c-green); color: #fff; }
        .cs-kicker { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-muted); }
        .cs-headline { font-size: 22px; font-weight: 600; color: var(--c-green-deep); margin: 5px 0 6px; letter-spacing: -0.01em; }
        .cs-statussub { font-size: 13.5px; color: var(--c-text-soft); line-height: 1.5; }
        .cs-right { border-left: 1px solid var(--c-soft-line); padding-left: 24px; }
        .cs-score { margin-top: 5px; font-size: 16px; color: var(--c-muted); }
        .cs-score b { font-size: 40px; font-weight: 600; color: var(--c-text); font-family: var(--c-mono); }
        .cs-week { font-size: 13px; color: var(--c-text-soft); margin-top: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .cs-delta { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--c-green-bg); color: var(--c-green-deep); }
        .cs-delta.up { background: var(--c-warn-bg); color: var(--c-warn); }
        .cs-delta.down { background: var(--c-green-bg); color: var(--c-green-deep); }
        .cs-delta.flat { background: var(--c-soft); color: var(--c-text-soft); }
        .cs-trend { margin-top: 12px; }
        .sec-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
        .sec-head .sec-title { color: var(--c-shell-text); }
        .sec-title { font-size: 19px; font-weight: 600; color: var(--c-text); }
        .sec-head .sec-sub { color: var(--c-shell-text-soft); }
        .sec-sub { font-size: 13px; color: var(--c-text-soft); margin-top: 2px; }
        .wl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 30px; }
        .moved { margin-bottom: 30px; }
        .moved-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .moved-item { display: flex; gap: 12px; align-items: flex-start; }
        .moved-arrow { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: rgba(17,22,18,.08); color: var(--c-muted); }
        .moved-arrow.bad { background: var(--c-bad-bg); color: var(--c-bad); }
        .moved-arrow.ok { background: var(--c-green-bg); color: var(--c-green-deep); }
        .moved-label { font-size: 14px; font-weight: 600; }
        .moved-change { font-size: 13px; color: var(--c-text-soft); margin-top: 2px; }
        .moved-change.bad { color: var(--c-bad); } .moved-change.ok { color: var(--c-green-deep); }
        .moved-tag { font-size: 11.5px; color: var(--c-muted); margin-top: 1px; }
        .moved-note { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--c-muted); margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--c-border); }
        .bottomline { display: flex; gap: 16px; align-items: flex-start; }
        .bl-icon { width: 56px; height: 56px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--c-green); color: #fff; }
        .bl-h { font-size: 22px; font-weight: 600; color: var(--c-green-deep); margin: 5px 0 6px; }
        .bl-m { font-size: 14px; color: var(--c-text-soft); line-height: 1.55; max-width: 60ch; }
        .bl-m .swap { border-bottom: 2px dotted var(--c-warn); text-decoration: none; padding-bottom: 1px; }
        .dfoot { text-align: center; font-size: 12.5px; color: var(--c-muted); margin-top: 36px; }
        @media (max-width: 720px) {
          .cs { grid-template-columns: 1fr; }
          .cs-right { border-left: none; border-top: 1px solid var(--c-soft-line); padding-left: 0; padding-top: 18px; }
        }
      `}</style>
    </AppShell>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const gated = await loadGatedProps(ctx)
  if ('redirect' in gated) return gated
  // Fetch the shared macro bundle server-side too, so the dashboard's Current
  // Status / score / watchlist render in the initial HTML (same instant paint as
  // the public landing). Reads the shared Redis-cached bundle so TTFB isn't blocked
  // on a fresh ~25-call FRED build on every dashboard load.
  const initial = JSON.parse(JSON.stringify(await getCachedBundle())) as Bundle
  return { props: { ...gated.props, initial } }
}
