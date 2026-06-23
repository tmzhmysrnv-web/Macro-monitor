// pages/api/account/delete.ts
// Permanently deletes the signed-in user. Deleting the auth user cascades to
// profiles / user_preferences / user_interests (FK on delete cascade). Requires
// the service-role client; the caller is identified from their own session.
import type { NextApiRequest, NextApiResponse } from 'next'
import { getSupabaseServer, getSupabaseAdmin } from '../../../lib/supabase/server'
import { sameOrigin } from '../../../lib/http'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Request must come from the app.' })

  const supabase = getSupabaseServer(req, res)
  const admin = getSupabaseAdmin()
  if (!supabase || !admin) return res.status(503).json({ error: 'Accounts are not configured.' })

  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) return res.status(401).json({ error: 'Not signed in.' })

  const del = await admin.auth.admin.deleteUser(data.user.id)
  if (del.error) {
    console.error('Account delete failed:', del.error)
    return res.status(500).json({ error: 'Could not delete account.' })
  }
  await supabase.auth.signOut()
  return res.status(200).json({ ok: true })
}
