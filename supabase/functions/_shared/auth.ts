export type AdminContext = {
  userId: string
  owner: 'Raphael' | 'Tim'
  token: string
}

function errorResponse(message: string, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Requires a real user session (the anon key is rejected by /auth/v1/user) and a row in `admins`.
// Uses the caller's own token for every DB read, so RLS applies.
export async function requireAdmin(
  request: Request,
  corsHeaders: Record<string, string>,
): Promise<AdminContext | Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) return errorResponse('Server auth is not configured.', 500, corsHeaders)

  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) return errorResponse('Missing user session.', 401, corsHeaders)

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userResponse.ok) {
    await userResponse.body?.cancel()
    return errorResponse('Invalid or expired user session.', 401, corsHeaders)
  }

  const user = await userResponse.json() as { id?: string }
  if (!user.id) return errorResponse('Invalid or expired user session.', 401, corsHeaders)

  const adminResponse = await fetch(
    `${supabaseUrl}/rest/v1/admins?select=collection_owner&user_id=eq.${encodeURIComponent(user.id)}`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } },
  )
  if (!adminResponse.ok) {
    console.error('Admin lookup failed:', adminResponse.status, await adminResponse.text())
    return errorResponse('Could not verify admin access.', 500, corsHeaders)
  }

  const rows = await adminResponse.json() as { collection_owner?: string }[]
  const owner = rows[0]?.collection_owner
  if (owner !== 'Raphael' && owner !== 'Tim') return errorResponse('Not an admin.', 403, corsHeaders)

  return { userId: user.id, owner, token }
}
