import type { SupabaseClient } from '@supabase/supabase-js'

export async function destinationAfterSignIn(supabase: SupabaseClient, userId: string | undefined): Promise<'/dashboard' | '/onboarding'> {
  if (!userId) return '/dashboard'
  const { count, error } = await supabase
    .from('user_interests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) return '/onboarding'
  return (count ?? 0) > 0 ? '/dashboard' : '/onboarding'
}
