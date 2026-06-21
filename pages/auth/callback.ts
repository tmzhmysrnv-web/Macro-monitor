// pages/auth/callback.ts
// OAuth (and email-confirmation) return URL. Exchanges the `code` for a session
// — which sets the auth cookies via the server client — then forwards new users
// to onboarding and returning users to their dashboard. Whitelist this URL
// (…/auth/callback) in Supabase Auth → URL Configuration and the Google client.
import type { GetServerSidePropsContext } from 'next'
import { getSupabaseServer } from '../../lib/supabase/server'

// Never rendered — getServerSideProps always redirects.
export default function AuthCallback() {
  return null
}

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const code = typeof ctx.query.code === 'string' ? ctx.query.code : null
  const supabase = getSupabaseServer(ctx.req, ctx.res)
  if (!code || !supabase) {
    return { redirect: { destination: '/welcome', permanent: false } }
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return { redirect: { destination: '/welcome?error=auth', permanent: false } }
  }

  // New vs returning: send users with no interests yet through onboarding.
  const { count } = await supabase
    .from('user_interests')
    .select('id', { count: 'exact', head: true })

  return {
    redirect: { destination: (count ?? 0) > 0 ? '/dashboard' : '/onboarding', permanent: false },
  }
}
