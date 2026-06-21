// pages/digest.tsx — the Weekly Digest: schedule + frequency + a live preview of
// what your next digest will contain (your topics' status + the week's movers).
import { useEffect, useState } from 'react'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppShell from '../components/app/AppShell'
import Icon from '../components/Icon'
import { loadGatedProps, type GatedProps } from '../lib/supabase/server'
import { INTEREST_CATALOG, readInterest } from '../lib/interests'
import { getSupabaseBrowser } from '../lib/supabase/client'

type Freq = 'breaking' | 'daily' | 'weekly'
const FREQ: { id: Freq; label: string }[] = [
  { id: 'breaking', label: 'Only when breaking' }, { id: 'weekly', label: 'Weekly' },
]
const BADGE: Record<string, string> = { ok: 'badge-ok', warn: 'badge-warn', alert: 'badge-alert' }

function nextSunday() {
  const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7))
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function Digest(props: GatedProps) {
  const supabase = getSupabaseBrowser()
  const [freq, setFreq] = useState<Freq>(props.preferences.digest_frequency)
  const [values, setValues] = useState<Record<string, number | null> | null>(null)
  const [saved, setSaved] = useState(false)
  const mine = INTEREST_CATALOG.filter(i => props.interests.includes(i.category))

  useEffect(() => { fetch('/api/data').then(r => r.json()).then(setValues).catch(() => setValues({})) }, [])

  async function setFrequency(f: Freq) {
    setFreq(f)
    if (!supabase) return
    await supabase.from('user_preferences').update({ digest_frequency: f, updated_at: new Date().toISOString() }).eq('user_id', props.user.id)
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  const cadence = freq === 'weekly' ? `every Sunday — next on ${nextSunday()}`
    : 'only when something truly breaks'

  return (
    <AppShell user={props.user} active="/digest">
      <Head><title>Weekly Digest · Is the World Breaking?</title></Head>
      <h1 className="p-title">Weekly Digest</h1>
      <p className="p-sub">A calm recap of your topics.{saved && <span className="p-saved"> · Saved</span>}</p>

      <div className="calm-card soft" style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="dg-cal"><Icon name="calendar" size={22} /></span>
        <div><div style={{ fontSize: 15, fontWeight: 600 }}>You'll get your digest {cadence}.</div>
          <div className="set-hint">Delivered to {props.user.email}.</div></div>
      </div>

      <div style={{ margin: '22px 0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div className="sec-title" style={{ fontSize: 16 }}>Frequency</div>
        <div className="seg">{FREQ.map(f => <button key={f.id} className={freq === f.id ? 'on' : ''} onClick={() => setFrequency(f.id)}>{f.label}</button>)}</div>
      </div>

      <div className="sec-title" style={{ fontSize: 16, margin: '24px 0 10px' }}>What your next digest will say</div>
      {mine.length === 0 ? (
        <div className="calm-card" style={{ color: 'var(--c-text-soft)' }}>Add topics in your Watchlist to fill your digest.</div>
      ) : (
        <div className="calm-card" style={{ padding: 8 }}>
          {mine.map(def => {
            const reading = values ? readInterest(def, values) : { status: 'ok' as const, badge: '…', insight: 'Loading…' }
            return (
              <div key={def.category} className="dg-row">
                <span className="dg-icon"><Icon name={def.icon} size={18} /></span>
                <div className="dg-row-main">
                  <div className="dg-row-top"><span className="dg-name">{def.label}</span><span className={`badge ${BADGE[reading.status]}`}>{reading.badge}</span></div>
                  <div className="dg-insight">{reading.insight}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        .p-title { font-size: 26px; font-weight: 600; }
        .p-sub { font-size: 14px; color: var(--c-text-soft); margin-top: 4px; }
        .p-saved { color: var(--c-green-deep); font-weight: 500; }
        .sec-title { font-weight: 600; }
        .set-hint { font-size: 12.5px; color: var(--c-muted); margin-top: 3px; }
        .dg-cal { width: 44px; height: 44px; border-radius: 12px; background: #fff; border: 1px solid var(--c-soft-line); color: var(--c-green-deep); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .dg-row { display: flex; gap: 12px; padding: 13px 12px; border-bottom: 1px solid var(--c-border); }
        .dg-row:last-child { border-bottom: none; }
        .dg-icon { width: 34px; height: 34px; border-radius: 9px; background: var(--c-soft); color: var(--c-green-deep); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .dg-row-main { flex: 1; min-width: 0; }
        .dg-row-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .dg-name { font-size: 14.5px; font-weight: 600; }
        .dg-insight { font-size: 13px; color: var(--c-text-soft); margin-top: 3px; line-height: 1.45; }
      `}</style>
    </AppShell>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return loadGatedProps(ctx)
}
