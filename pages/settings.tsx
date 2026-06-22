// pages/settings.tsx — notification preferences + delete account. Toggles and
// frequency save immediately (RLS-scoped writes to user_preferences).
import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppShell from '../components/app/AppShell'
import { loadGatedProps, type GatedProps } from '../lib/supabase/server'
import { getSupabaseBrowser, supaErr } from '../lib/supabase/client'

type Freq = 'breaking' | 'daily' | 'weekly'
const FREQ: { id: Freq; label: string }[] = [
  { id: 'breaking', label: 'Only when breaking' }, { id: 'weekly', label: 'Weekly' },
]

export default function Settings(props: GatedProps) {
  const router = useRouter()
  const supabase = getSupabaseBrowser()
  const [emailOn, setEmailOn] = useState(props.preferences.email_enabled)
  const [pushOn, setPushOn] = useState(props.preferences.push_enabled)
  const [freq, setFreq] = useState<Freq>(props.preferences.digest_frequency)
  const [saved, setSaved] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState('')

  async function save(patch: Record<string, unknown>) {
    if (!supabase) return
    setErr('')
    const { error } = await supabase.from('user_preferences')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', props.user.id)
    if (error) { setErr(supaErr(error)); return }
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  async function deleteAccount() {
    setDeleting(true); setErr('')
    try {
      const r = await fetch('/api/account/delete', { method: 'POST' })
      if (!r.ok) throw new Error((await r.json()).error || 'Failed')
      if (supabase) await supabase.auth.signOut()
      router.push('/')
    } catch (e) {
      setErr(supaErr(e, 'Could not delete account.'))
      setDeleting(false)
    }
  }

  return (
    <AppShell user={props.user} active="/settings">
      <Head><title>Settings · Is the World Breaking?</title></Head>
      <h1 className="p-title">Settings</h1>
      <p className="p-sub">Manage how and when we reach you.{saved && <span className="p-saved"> · Saved</span>}</p>

      <div className="calm-card" style={{ marginTop: 20 }}>
        <div className="set-row">
          <div><div className="set-label">Email notifications</div><div className="set-hint">Alerts and digests sent to {props.user.email}</div></div>
          <label className="switch"><input type="checkbox" checked={emailOn} onChange={e => { setEmailOn(e.target.checked); save({ email_enabled: e.target.checked }) }} /><span className="track" /><span className="knob" /></label>
        </div>
        <div className="set-div" />
        <div className="set-row">
          <div><div className="set-label">Browser push notifications</div><div className="set-hint">Coming soon — we'll save your preference for when it's ready.</div></div>
          <label className="switch"><input type="checkbox" checked={pushOn} onChange={e => { setPushOn(e.target.checked); save({ push_enabled: e.target.checked }) }} /><span className="track" /><span className="knob" /></label>
        </div>
        <div className="set-div" />
        <div className="set-row">
          <div><div className="set-label">Notification frequency</div><div className="set-hint">Breaking = alerts only when something breaks. Weekly adds a Sunday recap.</div></div>
          <div className="seg">
            {FREQ.map(f => <button key={f.id} className={freq === f.id ? 'on' : ''} onClick={() => { setFreq(f.id); save({ digest_frequency: f.id }) }}>{f.label}</button>)}
          </div>
        </div>
      </div>

      <div className="calm-card" style={{ marginTop: 20, borderColor: '#EAD7D5' }}>
        <div className="set-label">Delete account</div>
        <div className="set-hint" style={{ marginBottom: 14 }}>Permanently removes your account, interests, and preferences. This can't be undone.</div>
        {!confirming ? (
          <button className="btn btn-danger" onClick={() => setConfirming(true)}>Delete my account</button>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 13.5 }}>Are you sure?</span>
            <button className="btn btn-danger" onClick={deleteAccount} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, delete'}</button>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
          </div>
        )}
      </div>

      {err && <div className="auth-err" style={{ textAlign: 'left' }}>{err}</div>}

      <style>{`
        .p-title { font-size: 26px; font-weight: 600; }
        .p-sub { font-size: 14px; color: var(--c-text-soft); margin-top: 4px; }
        .p-saved { color: var(--c-green-deep); font-weight: 500; }
        .set-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .set-label { font-size: 15px; font-weight: 500; }
        .set-hint { font-size: 12.5px; color: var(--c-muted); margin-top: 3px; line-height: 1.45; }
        .set-div { height: 1px; background: var(--c-border); margin: 16px 0; }
      `}</style>
    </AppShell>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return loadGatedProps(ctx)
}
