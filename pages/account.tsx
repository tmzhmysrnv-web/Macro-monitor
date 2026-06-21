// pages/account.tsx — profile (name, email, avatar) + sign out.
import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppShell from '../components/app/AppShell'
import Icon from '../components/Icon'
import { loadGatedProps, type GatedProps } from '../lib/supabase/server'
import { getSupabaseBrowser, supaErr } from '../lib/supabase/client'

export default function Account(props: GatedProps) {
  const router = useRouter()
  const supabase = getSupabaseBrowser()
  const [name, setName] = useState(props.user.name ?? '')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function saveName() {
    if (!supabase) return
    setBusy(true); setErr('')
    const { error } = await supabase.from('profiles').update({ full_name: name || null }).eq('id', props.user.id)
    setBusy(false)
    if (error) { setErr(supaErr(error)); return }
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
    router.push('/')
  }

  const initials = ((name || props.user.email)[0] ?? '?').toUpperCase()

  return (
    <AppShell user={props.user} active="/account">
      <Head><title>Account · Is the World Breaking?</title></Head>
      <h1 className="p-title">Account</h1>
      <p className="p-sub">Your profile.{saved && <span className="p-saved"> · Saved</span>}</p>

      <div className="calm-card" style={{ marginTop: 20, maxWidth: 520 }}>
        <div className="ac-id">
          <div className="ac-avatar">
            {props.user.avatar ? <img src={props.user.avatar} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>}
          </div>
          <div><div className="ac-email">{props.user.email}</div><div className="set-hint">Signed in</div></div>
        </div>

        <div style={{ marginTop: 18 }}>
          <label className="label">Full name</label>
          <input className="field" value={name} placeholder="Your name" onChange={e => setName(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="label">Email</label>
          <input className="field" value={props.user.email} disabled />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={saveName} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-ghost" onClick={signOut}><Icon name="logout" size={16} /> Sign out</button>
        </div>
        {err && <div className="auth-err" style={{ textAlign: 'left' }}>{err}</div>}
      </div>

      <style>{`
        .p-title { font-size: 26px; font-weight: 600; }
        .p-sub { font-size: 14px; color: var(--c-text-soft); margin-top: 4px; }
        .p-saved { color: var(--c-green-deep); font-weight: 500; }
        .ac-id { display: flex; align-items: center; gap: 14px; }
        .ac-avatar { width: 52px; height: 52px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: var(--c-green-bg); color: var(--c-green-deep); display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 600; }
        .ac-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .ac-email { font-size: 15px; font-weight: 500; }
        .set-hint { font-size: 12.5px; color: var(--c-muted); margin-top: 3px; }
      `}</style>
    </AppShell>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return loadGatedProps(ctx)
}
