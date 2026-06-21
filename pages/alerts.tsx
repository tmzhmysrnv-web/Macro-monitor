// pages/alerts.tsx — live alerts, filtered to the topics the user follows.
// Same source as the public site's break meter, themed for the calm app.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppShell from '../components/app/AppShell'
import Icon from '../components/Icon'
import { loadGatedProps, type GatedProps } from '../lib/supabase/server'
import { METRIC_CATEGORY } from '../lib/overview'
import { TAB_TO_CATEGORIES } from '../lib/interests'

type Alert = { key: string; label: string; message: string }

export default function Alerts(props: GatedProps) {
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const follows = new Set(props.interests)

  useEffect(() => {
    fetch('/api/breakmeter').then(r => r.json()).then(d => setAlerts(d.alerts ?? [])).catch(() => setAlerts([]))
  }, [])

  // Keep only alerts whose tab maps to a followed interest.
  const mine = (alerts ?? []).filter(a => {
    const tab = METRIC_CATEGORY[a.key]?.tab
    if (!tab) return false
    return (TAB_TO_CATEGORIES[tab] ?? []).some(c => follows.has(c))
  })

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
            const cat = METRIC_CATEGORY[a.key]
            return (
              <button key={a.key} className="al-card" onClick={() => router.push(`/?tab=${cat?.tab ?? 'overview'}`)}>
                <span className="al-icon"><Icon name="alert-triangle" size={20} /></span>
                <div>
                  <div className="al-title">{a.label}{cat && <span className="al-tab"> · {cat.label}</span>}</div>
                  <div className="al-msg">{a.message}</div>
                </div>
                <Icon name="arrow-right" size={16} />
              </button>
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
        .al-card { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; cursor: pointer;
          background: var(--c-surface); border: 1px solid var(--c-border); border-left: 3px solid var(--c-warn); border-radius: 14px; padding: 16px 18px; margin-bottom: 12px; color: var(--c-text-soft); }
        .al-card:hover { border-color: var(--c-border-strong); }
        .al-icon { color: var(--c-warn); flex-shrink: 0; }
        .al-title { font-size: 15px; font-weight: 600; color: var(--c-text); }
        .al-tab { font-weight: 400; color: var(--c-muted); font-size: 13px; }
        .al-msg { font-size: 13px; margin-top: 3px; line-height: 1.45; }
        .al-card > svg:last-child { margin-left: auto; color: var(--c-muted); flex-shrink: 0; }
      `}</style>
    </AppShell>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return loadGatedProps(ctx)
}
