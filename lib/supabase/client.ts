// lib/supabase/client.ts
// Browser-side Supabase client (anon key). Used by the signed-in app for auth
// (Google OAuth + email/password) and RLS-scoped CRUD on the user's own
// profile / preferences / interests rows.
//
// Degrades gracefully: when the public env vars are absent (e.g. the public
// graphite site building without Supabase configured), supabaseReady() returns
// false and getSupabaseBrowser() returns null so callers can no-op.
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export function supabaseReady(): boolean {
  return !!(url() && anon())
}

let _client: SupabaseClient | null = null

export function getSupabaseBrowser(): SupabaseClient | null {
  if (_client) return _client
  if (!supabaseReady()) return null
  _client = createBrowserClient(url()!, anon()!)
  return _client
}
