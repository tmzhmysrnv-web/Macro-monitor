// lib/supabase/server.ts
// Server-side Supabase clients for the Pages Router:
//   • getSupabaseServer(req, res) — request-scoped client wired to the request's
//     cookies, used in getServerSideProps + API routes to read/refresh the session.
//   • requireUser(ctx) — gate helper; returns the signed-in user or a redirect to
//     /welcome (used by every login-only page's getServerSideProps).
//   • getSupabaseAdmin() — service-role client for privileged ops (account delete,
//     listing alert recipients). Never import this into client bundles.
//
// All helpers degrade gracefully when Supabase env is absent so the public site
// still builds/runs without Supabase configured (mirrors lib/redis.ts).
import { createServerClient, parseCookieHeader, serializeCookieHeader, type CookieOptions } from '@supabase/ssr'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { IncomingMessage, ServerResponse } from 'http'
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next'

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY

export function supabaseServerReady(): boolean {
  return !!(url() && anon())
}
export function supabaseAdminReady(): boolean {
  return !!(url() && serviceKey())
}

// Minimal shapes shared by GetServerSidePropsContext and NextApi req/res.
type ReqLike = IncomingMessage & { cookies?: Partial<Record<string, string>> }
type ResLike = ServerResponse

export function getSupabaseServer(req: ReqLike, res: ResLike): SupabaseClient | null {
  if (!supabaseServerReady()) return null
  return createServerClient(url()!, anon()!, {
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie ?? '').map(c => ({
          name: c.name,
          value: c.value ?? '',
        }))
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        const prev = res.getHeader('Set-Cookie')
        const existing = Array.isArray(prev) ? prev : prev ? [String(prev)] : []
        const added = cookiesToSet.map(({ name, value, options }) =>
          serializeCookieHeader(name, value, options),
        )
        res.setHeader('Set-Cookie', [...existing, ...added])
      },
    },
  })
}

// Service-role client — bypasses RLS. Server-only.
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!supabaseAdminReady()) return null
  return createClient(url()!, serviceKey()!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Gate a login-only page. Returns { user, supabase } when signed in, otherwise a
// getServerSideProps redirect result to /welcome.
export async function requireUser(
  ctx: GetServerSidePropsContext,
): Promise<{ user: User; supabase: SupabaseClient } | { redirect: GetServerSidePropsResult<never> }> {
  const redirect = { redirect: { redirect: { destination: '/welcome', permanent: false } } } as const
  const supabase = getSupabaseServer(ctx.req, ctx.res)
  if (!supabase) return redirect
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) return redirect
  return { user: data.user, supabase }
}

// Serializable props shared by every signed-in page (sidebar user chip + the
// user's interests/preferences). Returns a getServerSideProps redirect when the
// visitor isn't signed in.
export type AppUser = { id: string; email: string; name: string | null; avatar: string | null }
export type AppPrefs = { digest_frequency: 'breaking' | 'weekly'; email_enabled: boolean; push_enabled: boolean }
export type GatedProps = { user: AppUser; interests: string[]; preferences: AppPrefs }

const DEFAULT_PREFS: AppPrefs = { digest_frequency: 'weekly', email_enabled: true, push_enabled: false }

export async function loadGatedProps(
  ctx: GetServerSidePropsContext,
): Promise<{ props: GatedProps } | { redirect: { destination: string; permanent: boolean } }> {
  const gate = await requireUser(ctx)
  if ('redirect' in gate) return { redirect: { destination: '/welcome', permanent: false } }
  const { user, supabase } = gate

  const [profileR, interestsR, prefsR] = await Promise.all([
    supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).maybeSingle(),
    supabase.from('user_interests').select('category').eq('user_id', user.id),
    supabase.from('user_preferences').select('digest_frequency, email_enabled, push_enabled').eq('user_id', user.id).maybeSingle(),
  ])

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const appUser: AppUser = {
    id: user.id,
    email: user.email ?? '',
    name: (profileR.data?.full_name as string | null) ?? (meta.full_name as string) ?? (meta.name as string) ?? null,
    avatar: (profileR.data?.avatar_url as string | null) ?? (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
  }
  return {
    props: {
      user: appUser,
      interests: (interestsR.data ?? []).map(r => r.category as string),
      preferences: (prefsR.data as AppPrefs | null) ?? DEFAULT_PREFS,
    },
  }
}
