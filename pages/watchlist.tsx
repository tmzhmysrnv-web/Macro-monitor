// pages/watchlist.tsx — add/remove the topics on your dashboard. Changes save
// immediately (RLS-scoped writes to user_interests).
import { useState } from 'react'
import Head from 'next/head'
import type { GetServerSidePropsContext } from 'next'
import AppShell from '../components/app/AppShell'
import Icon from '../components/Icon'
import { loadGatedProps, type GatedProps } from '../lib/supabase/server'
import { INTEREST_CATALOG, type InterestCategory } from '../lib/interests'
import { getSupabaseBrowser, supaErr } from '../lib/supabase/client'

export default function Watchlist(props: GatedProps) {
  const supabase = getSupabaseBrowser()
  const [sel, setSel] = useState<Set<InterestCategory>>(new Set(props.interests as InterestCategory[]))
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  async function toggle(c: InterestCategory) {
    if (!supabase) return
    const adding = !sel.has(c)
    setSel(prev => { const n = new Set(prev); adding ? n.add(c) : n.delete(c); return n })
    setErr('')
    try {
      if (adding) {
        const { error } = await supabase.from('user_interests').upsert({ user_id: props.user.id, category: c }, { onConflict: 'user_id,category' })
        if (error) throw error
      } else {
        const { error } = await supabase.from('user_interests').delete().eq('user_id', props.user.id).eq('category', c)
        if (error) throw error
      }
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      // revert on failure
      setSel(prev => { const n = new Set(prev); adding ? n.delete(c) : n.add(c); return n })
      setErr(supaErr(e))
    }
  }

  return (
    <AppShell user={props.user} active="/watchlist">
      <Head><title>Watchlist · Is the World Breaking?</title></Head>
      <h1 className="p-title">Watchlist</h1>
      <p className="p-sub">Pick the topics you want on your dashboard. We'll watch them and alert you only when they truly change.{saved && <span className="p-saved"> · Saved</span>}</p>
      {err && <div className="auth-err" style={{ textAlign: 'left' }}>{err}</div>}

      <div className="pickgrid" style={{ marginTop: 20 }}>
        {INTEREST_CATALOG.map(it => (
          <button key={it.category} type="button" className={`pickcard ${sel.has(it.category) ? 'sel' : ''}`} onClick={() => toggle(it.category)}>
            <div className="pc-icon"><Icon name={it.icon} size={22} /></div>
            <div className="pc-title">{it.label}</div>
            <div className="pc-blurb">{it.blurb}</div>
          </button>
        ))}
      </div>

      <style>{`
        .p-title { font-size: 26px; font-weight: 600; }
        .p-sub { font-size: 14px; color: var(--c-text-soft); margin-top: 4px; line-height: 1.5; max-width: 64ch; }
        .p-saved { color: var(--c-green-deep); font-weight: 500; }
      `}</style>
    </AppShell>
  )
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return loadGatedProps(ctx)
}
