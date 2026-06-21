// pages/alerts.tsx — live alerts, filtered to the topics the user follows.
// Pulls the rich active alerts (/api/alerts → buildAlertReport) and renders full
// alert cards (what / why / areas affected), themed for the calm app.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppShell from '../components/app/AppShell'
import Icon from '../components/Icon'
import { loadGatedProps, type GatedProps } from '../lib/supabase/server'
import { TAB_TO_CATEGORIES } from '../lib/interests'

type FiredAlert = {
  key: string; id: string; tab: string; tabLabel: string; severity: number
  title: string; what: string; why: string; affected: string[]; context: string
}

// Light-theme tier color: high severity = red, lowest = green, else amber.
function sev(s: number): { color: string; bg: string } {
  if (s >= 3) return { color: 'var(--c-bad)', bg: 'var(--c-bad-bg)' }
  if (s <= 1) return { color: 'var(--c-ok)', bg: 'var(--c-green-bg)' }
  return { color: 'var(--c-warn)', bg: 'var(--c-warn-bg)' }
}

export default function Alerts(props: GatedProps) {
  const router = useRouter()
  const [alerts, setAlerts] = useState<FiredAlert[] | null>(null)
  const follows = new Set(props.interests)

  useEffect(() => {
    fetch('/api/alerts').then(r => r.json()).then(d => setAlerts(d.alerts ?? [])).catch(() => setAlerts([]))
  }, [])

  // Keep only alerts whose tab maps to a followed interest.
  const mine = (alerts ?? []).filter(a => (TAB_TO_CATEGORIES[a.tab] ?? []).some(c => follows.has(c)))

  return (
    <AppShell user={props.user} active="/alerts">
      <Head><title>Alerts · Is the World Breaking?</title></Head>
      <h1 className="p-title">Alerts</h1>
      <p className="p-sub">Active alerts on the topics you follow. We stay quiet until something truly crosses a line.</p>

      <div style={{ marginTop: 22 }}>
        {alerts == null ? (
          <div className="calm-card" style={{ color: 'var(--c-muted)' }}>Checking the latest readings…</div>
        ) : mine.length === 0 ? (
          <div className="calm-card al-empty">
            <div className="al-empty-mark"><Icon name="circle-check" size={40} /></div>
            <div className="al-empty-h">Nothing is breaking right now.</div>
            <div className="al-empty-s">We'll surface alerts here — and email you — the moment one of your topics crosses a line.</div>
          </div>
        ) : (
          mine.map(a => {
            const s = sev(a.severity)
            return (
              <div key={a.key} className="al-card" style={{ borderLeftColor: s.color }}>
                <div className="al-top">
                  <span className="al-chip" style={{ color: s.color, background: s.bg }}>{a.tabLabel}</span>
                  <button className="al-open" onClick={() => router.push(`/?tab=${a.tab}`)}>
                    Open {a.tabLabel.toLowerCase()} <Icon name="arrow-right" size={14} />
                  </button>
                </div>
                <div className="al-title">{a.title}</div>
                {a.what && <div className="al-line"><b>What — </b>{a.what}</div>}
                {a.why && <div className="al-line"><b>Why — </b>{a.why}</div>}
                {a.affected?.length > 0 && (
                  <>
                    <div className="al-areas-label">areas affected</div>
                    <div className="al-areas">{a.affected.map(x => <span key={x} className="al-area">{x.toLowerCase()}</span>)}</div>
                  </>
                )}
                {a.context && <div className="al-ctx"><b>Historically — </b>{a.context}</div>}
              </div>
            )
          })
        )}
      </div>

      <style>{`
        .p-title { font-size: 26px; font-weight: 600; }
        .p-sub { font-size: 14px; color: var(--c-text-soft); margin-top: 4px; max-width: 64ch; line-height: 1.5; }
        .al-empty { text-align: center; padding: 44px 24px; }
        .al-empty-mark { color: var(--c-green); display: flex; justify-content: center; margin-bottom: 12px; }
        .al-empty-h { font-size: 16px; font-weight: 600; }
        .al-empty-s { font-size: 13.5px; color: var(--c-text-soft); margin-top: 6px; line-height: 1.5; max-width: 44ch; margin-left: auto; margin-right: auto; }
        .al-card { background: var(--c-surface); border: 1px solid var(--c-border); border-left: 3px solid var(--c-warn);
          border-radius: 14px; padding: 16px 18px; margin-bottom: 12px; }
        .al-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .al-chip { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
        .al-open { background: none; border: none; cursor: pointer; color: var(--c-green-deep); font-family: var(--c-sans); font-size: 12.5px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; }
        .al-title { font-size: 16px; font-weight: 600; color: var(--c-text); margin-bottom: 9px; }
        .al-line { font-size: 13.5px; color: var(--c-text-soft); line-height: 1.55; margin-bottom: 6px; }
        .al-line b { color: var(--c-text); font-weight: 600; }
        .al-areas-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-muted); margin: 10px 0 6px; }
        .al-areas { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
        .al-area { font-size: 11.5px; color: var(--c-text-soft); background: var(--c-soft); padding: 3px 9px; border-radius: 7px; }
        .al-ctx { font-size: 12.5px; color: var(--c-muted); line-height: 1.5; margin-top: 8px; }
        .al-ctx b { color: var(--c-text-soft); font-weight: 600; }
      `}</style>
    </AppShell>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return loadGatedProps(ctx)
}
