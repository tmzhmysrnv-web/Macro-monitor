// components/app/AppShell.tsx
// The signed-in app frame: a left sidebar (brand, nav, next-digest card, user
// chip with sign-out) + a main content column. Theme tokens via <AppTheme/>.
// Collapses to a top bar on narrow screens for mobile.
import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import AppTheme from './AppTheme'
import Icon, { type IconName } from '../Icon'
import { getSupabaseBrowser } from '../../lib/supabase/client'

export type ShellUser = { email: string; name: string | null; avatar: string | null }

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
  { href: '/alerts', label: 'Alerts', icon: 'bell' },
  { href: '/digest', label: 'Weekly Digest', icon: 'calendar' },
  { href: '/watchlist', label: 'Watchlist', icon: 'heart' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
  { href: '/account', label: 'Account', icon: 'user' },
  { href: '/support', label: 'Support', icon: 'heart' },
]

// Next Sunday, formatted like "Sunday, May 25".
function nextSunday(): string {
  const d = new Date()
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7))
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function initials(user: ShellUser): string {
  const base = user.name || user.email || '?'
  const parts = base.split(/[\s@.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || base[0].toUpperCase()
}

export default function AppShell({ user, active, children }: { user: ShellUser; active: string; children: React.ReactNode }) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    const supabase = getSupabaseBrowser()
    if (supabase) await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <>
      <AppTheme />
      <div className="app shell">
        <aside className="sb">
          <div className="sb-brand">
            <Link href="/" className="sb-brand-link" title="Back to overview">
              <span className="brand">is the world breaking?...<span className="brand-cursor" aria-hidden="true" /></span>
            </Link>
          </div>
          <div className="sb-tag">We monitor the economy so you don't have to.</div>

          <nav className="sb-nav">
            {NAV.map(n => (
              <Link key={n.href} href={n.href} className={`sb-link ${active === n.href ? 'on' : ''}`}>
                <Icon name={n.icon} size={18} /> {n.label}
              </Link>
            ))}
          </nav>

          <div className="sb-digest">
            <div className="sb-digest-h">Next Weekly Digest</div>
            <div className="sb-digest-d"><Icon name="calendar" size={14} /> {nextSunday()}</div>
            <div className="sb-digest-s">You'll get your digest every Sunday morning.</div>
          </div>

          <div className="sb-spacer" />

          <div className="sb-user">
            <div className="sb-avatar">
              {user.avatar
                ? <img src={user.avatar} alt="" width={34} height={34} referrerPolicy="no-referrer" />
                : <span>{initials(user)}</span>}
            </div>
            <div className="sb-user-meta">
              <div className="sb-user-name">{user.name || 'Your account'}</div>
              <div className="sb-user-email">{user.email}</div>
            </div>
            <button className="sb-signout" onClick={signOut} disabled={signingOut} title="Sign out" aria-label="Sign out">
              <Icon name="logout" size={17} />
            </button>
          </div>
        </aside>

        <main className="main">{children}</main>
      </div>

      <style>{`
        .app.shell { display: grid; grid-template-columns: 256px 1fr; align-items: stretch; }
        .sb { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column;
          background: var(--c-shell-bg); border-right: 1px solid var(--c-shell-border); padding: 22px 16px; color: var(--c-shell-text); }
        .sb-brand { display: flex; align-items: center; gap: 10px; color: var(--c-shell-green); }
        .sb-brand-name { font-size: 15px; font-weight: 600; line-height: 1.2; color: var(--c-shell-text); }
        .sb-brand-link, .sb-brand-link:hover { text-decoration: none; }
        .sb-tag { font-size: 12px; color: var(--c-shell-muted); line-height: 1.4; margin: 10px 2px 20px; }
        .sb-nav { display: flex; flex-direction: column; gap: 2px; }
        .sb-link { display: flex; align-items: center; gap: 11px; font-size: 14px; color: var(--c-shell-green);
          padding: 10px 12px; border-radius: 10px; transition: background .12s, color .12s; }
        .sb-link:hover { background: rgba(255,255,255,.06); text-decoration: none; color: var(--c-shell-green); }
        .sb-link.on { background: var(--c-shell-active-bg); color: var(--c-shell-active-text); font-weight: 600; }
        .sb-digest { margin-top: 22px; background: var(--c-surface); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 13px; color: var(--c-text); }
        .sb-digest-h { font-size: 13px; font-weight: 600; }
        .sb-digest-d { font-size: 12.5px; color: var(--c-text); display: flex; align-items: center; gap: 6px; margin: 7px 0 5px; }
        .sb-digest-s { font-size: 11.5px; color: var(--c-text-soft); line-height: 1.45; }
        .sb-spacer { flex: 1; }
        .sb-user { display: flex; align-items: center; gap: 10px; padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--c-shell-border); }
        .sb-avatar { width: 34px; height: 34px; border-radius: 50%; overflow: hidden; flex-shrink: 0;
          background: rgba(111,174,125,.16); color: var(--c-shell-green); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; }
        .sb-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .sb-user-meta { min-width: 0; flex: 1; }
        .sb-user-name { font-size: 13px; font-weight: 600; color: var(--c-shell-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sb-user-email { font-size: 11.5px; color: var(--c-shell-text-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sb-signout { background: none; border: none; color: var(--c-shell-muted); cursor: pointer; padding: 6px; border-radius: 8px; flex-shrink: 0; }
        .sb-signout:hover { background: rgba(255,255,255,.06); color: var(--c-shell-text); }
        .main { padding: 34px clamp(20px, 4vw, 48px) 64px; max-width: 1080px; }

        @media (max-width: 860px) {
          .app.shell { grid-template-columns: 1fr; }
          .sb { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 14px 16px; }
          .sb-tag, .sb-digest, .sb-spacer { display: none; }
          .sb-nav { flex-direction: row; flex-wrap: wrap; order: 3; width: 100%; gap: 4px; }
          .sb-link { padding: 8px 10px; font-size: 13px; }
          .sb-brand { flex: 1; }
          .sb-user { order: 2; margin: 0; padding: 0; border: none; }
          .sb-user-meta { display: none; }
          .main { padding: 24px 18px 56px; }
        }
      `}</style>
    </>
  )
}
