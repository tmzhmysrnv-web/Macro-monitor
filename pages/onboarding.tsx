// pages/onboarding.tsx — steps 2–4 of signup: choose interests → notification
// preferences → success. Step 1 (Welcome) is pages/welcome.tsx. Saves interests
// + preferences to Supabase (RLS-scoped) on finish. Already-onboarded users are
// forwarded to /dashboard by getServerSideProps.
import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppTheme from '../components/app/AppTheme'
import Icon from '../components/Icon'
import { INTEREST_CATALOG, type InterestCategory } from '../lib/interests'
import { getSupabaseBrowser, supaErr } from '../lib/supabase/client'
import { getSupabaseServer } from '../lib/supabase/server'

type Freq = 'breaking' | 'daily' | 'weekly'
const FREQ: { id: Freq; label: string; sub: string }[] = [
  { id: 'breaking', label: 'Only when the world is breaking', sub: 'We stay silent until something truly changes.' },
  { id: 'weekly', label: 'Weekly digest', sub: 'Breaking alerts, plus one calm recap every Sunday.' },
]

export default function Onboarding() {
  const router = useRouter()
  const supabase = getSupabaseBrowser()
  const [step, setStep] = useState<'interests' | 'prefs' | 'done'>('interests')
  const [sel, setSel] = useState<Set<InterestCategory>>(new Set())
  const [freq, setFreq] = useState<Freq>('weekly')
  const [emailOn, setEmailOn] = useState(true)
  const [pushOn, setPushOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const toggle = (c: InterestCategory) => {
    setSel(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n })
  }

  async function finish() {
    if (!supabase) { setErr('Accounts are not configured.'); return }
    setBusy(true); setErr('')
    try {
      const { data: u } = await supabase.auth.getUser()
      const uid = u?.user?.id
      if (!uid) throw new Error('Your session expired. Please sign in again.')

      const rows = [...sel].map(category => ({ user_id: uid, category }))
      if (rows.length) {
        const { error } = await supabase.from('user_interests').upsert(rows, { onConflict: 'user_id,category' })
        if (error) throw error
      }
      const { error: pErr } = await supabase.from('user_preferences').upsert({
        user_id: uid, digest_frequency: freq, email_enabled: emailOn, push_enabled: pushOn, updated_at: new Date().toISOString(),
      })
      if (pErr) throw pErr
      setStep('done')
    } catch (e) {
      setErr(supaErr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Head><title>Set up · Is the World Breaking?</title></Head>
      <AppTheme />
      <div className="app auth-screen">
        <div className="auth-box" style={{ maxWidth: step === 'interests' ? 720 : 480 }}>

          {step === 'interests' && (
            <>
              <h1 className="auth-h1">Choose what you care about</h1>
              <p className="auth-sub">We'll build your dashboard around these and watch them for you.</p>
              <div className="pickgrid">
                {INTEREST_CATALOG.map(it => (
                  <button key={it.category} type="button"
                    className={`pickcard ${sel.has(it.category) ? 'sel' : ''}`} onClick={() => toggle(it.category)}>
                    <div className="pc-icon"><Icon name={it.icon} size={22} /></div>
                    <div className="pc-title">{it.label}</div>
                    <div className="pc-blurb">{it.blurb}</div>
                  </button>
                ))}
              </div>
              <button className="btn btn-primary btn-block" style={{ marginTop: 22 }}
                disabled={sel.size === 0} onClick={() => setStep('prefs')}>
                Continue{sel.size ? ` · ${sel.size} selected` : ''}
              </button>
            </>
          )}

          {step === 'prefs' && (
            <>
              <h1 className="auth-h1">How often should we interrupt you?</h1>
              <p className="auth-sub">You can change this anytime in Settings.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {FREQ.map(f => (
                  <button key={f.id} type="button" className={`pickcard ${freq === f.id ? 'sel' : ''}`} onClick={() => setFreq(f.id)}>
                    <div className="pc-title" style={{ marginBottom: 2 }}>{f.label}</div>
                    <div className="pc-blurb">{f.sub}</div>
                  </button>
                ))}
              </div>

              <div className="calm-card" style={{ marginTop: 18, padding: 16 }}>
                <Row label="Email notifications" on={emailOn} set={setEmailOn} />
                <div style={{ height: 12 }} />
                <Row label="Browser push notifications" on={pushOn} set={setPushOn} hint="Coming soon" />
              </div>

              {err && <div className="auth-err">{err}</div>}
              <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={busy} onClick={finish}>
                {busy ? 'Saving…' : 'Finish setup'}
              </button>
              <button className="auth-switch" style={{ display: 'block', margin: '12px auto 0' }} onClick={() => setStep('interests')}>
                ← Back
              </button>
            </>
          )}

          {step === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--c-green)', display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                <Icon name="circle-check" size={56} />
              </div>
              <h1 className="auth-h1">You're all set.</h1>
              <p className="auth-sub">Go enjoy your life. We'll keep watch.</p>
              <button className="btn btn-primary btn-block" onClick={() => router.push('/dashboard')}>Go to Dashboard</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Row({ label, on, set, hint }: { label: string; on: boolean; set: (v: boolean) => void; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontSize: 14 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>{hint}</div>}
      </div>
      <label className="switch">
        <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} />
        <span className="track" /><span className="knob" />
      </label>
    </div>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const supabase = getSupabaseServer(ctx.req, ctx.res)
  if (!supabase) return { redirect: { destination: '/welcome', permanent: false } }
  const { data } = await supabase.auth.getUser()
  if (!data?.user) return { redirect: { destination: '/welcome', permanent: false } }
  // Already onboarded → straight to the dashboard.
  const { count } = await supabase.from('user_interests').select('id', { count: 'exact', head: true })
  if ((count ?? 0) > 0) return { redirect: { destination: '/dashboard', permanent: false } }
  return { props: {} }
}
