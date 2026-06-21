// pages/welcome.tsx — "Create your calm" — the public entry to accounts.
// Google OAuth + email/password (sign in / sign up). On success, routes through
// /onboarding (which forwards already-onboarded users straight to /dashboard).
import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppTheme from '../components/app/AppTheme'
import { getSupabaseBrowser, supabaseReady } from '../lib/supabase/client'
import { getSupabaseServer } from '../lib/supabase/server'

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export default function Welcome() {
  const router = useRouter()
  const supabase = getSupabaseBrowser()
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  async function google() {
    if (!supabase) return
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) { setErr(error.message); setBusy(false) }
  }

  async function email_(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setErr(''); setNote(''); setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        })
        if (error) throw error
        if (data.session) { router.push('/onboarding'); return }
        setNote('Check your inbox to confirm your email, then sign in.')
        setMode('signin')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push('/onboarding')
        return
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Head><title>Create your calm · Is the World Breaking?</title></Head>
      <AppTheme />
      <div className="app auth-screen">
        <div className="auth-box">
          <div className="auth-title">is the world breaking?...<span className="brand-cursor" aria-hidden="true" /></div>
          <p className="auth-sub">Quiet the noise · We'll monitor things and alert you only when it matters</p>

          {!supabaseReady() ? (
            <div className="calm-card" style={{ textAlign: 'center', color: 'var(--c-text-soft)', fontSize: 14 }}>
              Accounts aren't configured yet. Add your Supabase keys to enable sign-in.
            </div>
          ) : (
            <>
              <button className="btn btn-google btn-block" onClick={google} disabled={busy}>
                <GoogleMark /> Continue with Google
              </button>

              <div className="divider">or</div>

              <form onSubmit={email_}>
                <div style={{ marginBottom: 12 }}>
                  <label className="label">Email</label>
                  <input className="field" type="email" required value={email} placeholder="you@example.com"
                    onChange={e => setEmail(e.target.value)} disabled={busy} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label className="label">Password</label>
                  <input className="field" type="password" required minLength={6} value={password} placeholder="••••••••"
                    onChange={e => setPassword(e.target.value)} disabled={busy} />
                </div>
                <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                  {busy ? '…' : mode === 'signup' ? 'Continue with Email' : 'Sign in'}
                </button>
              </form>

              {note && <div className="auth-note">{note}</div>}
              {err && <div className="auth-err">{err}</div>}

              <div className="auth-note">
                {mode === 'signup' ? 'Already have an account? ' : 'New here? '}
                <button className="auth-switch" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setErr(''); setNote('') }}>
                  {mode === 'signup' ? 'Sign in' : 'Create an account'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// Already signed in? Skip the welcome screen.
export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const supabase = getSupabaseServer(ctx.req, ctx.res)
  if (supabase) {
    const { data } = await supabase.auth.getUser()
    if (data?.user) return { redirect: { destination: '/dashboard', permanent: false } }
  }
  return { props: {} }
}
