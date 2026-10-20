import { requireAdmin, type AdminContext } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type SyncRequestRecord = {
  id: string
  discogsReleaseId: number
}

type SyncResult = {
  id: string
  status: 'added' | 'already_in_collection' | 'removed' | 'not_in_collection' | 'no_release' | 'failed'
  error?: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Discogs allows 60 req/min per token. Each record costs 2 requests (check + add/remove),
// so ~2.2s between records keeps us well under the limit.
const RECORD_DELAY_MS = 2200

// When Discogs answers 429, wait for the Retry-After hint (or a safe default) and retry.
async function fetchDiscogs(url: string, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let response: Response | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await fetch(url, init)
    if (response.status !== 429 || attempt === maxAttempts) return response

    const retryAfterSeconds = Number(response.headers.get('Retry-After'))
    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 10_000 * attempt
    console.log(`Discogs rate limited (429). Waiting ${waitMs}ms before retry ${attempt + 1}/${maxAttempts}.`)
    await response.body?.cancel()
    await sleep(waitMs)
  }
  return response!
}

function restHeaders(admin: AdminContext) {
  return {
    apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    Authorization: `Bearer ${admin.token}`,
  }
}

// Returns the subset of ids that belong to the caller. Uses the caller's token, so RLS applies too.
async function filterOwnedIds(ids: string[], admin: AdminContext): Promise<Set<string>> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl || ids.length === 0) return new Set()

  const response = await fetch(
    `${supabaseUrl}/rest/v1/vinyl_records?select=id&id=in.(${ids.join(',')})&collection_owner=eq.${encodeURIComponent(admin.owner)}`,
    { headers: restHeaders(admin) },
  )
  if (!response.ok) {
    console.error('Failed to verify record ownership:', response.status, await response.text())
    return new Set()
  }

  const rows = await response.json() as { id: string | number }[]
  return new Set(rows.map((row) => String(row.id)))
}

// Reads the caller's own Discogs token. The table is not reachable by clients, so this uses the
// service-role key, always filtered by the verified user id.
async function getDiscogsToken(admin: AdminContext): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Server is not configured to read Discogs tokens.')

  const response = await fetch(
    `${supabaseUrl}/rest/v1/admin_discogs_tokens?select=token&user_id=eq.${encodeURIComponent(admin.userId)}`,
    { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } },
  )
  if (!response.ok) throw new Error(`Could not read the Discogs token (HTTP ${response.status}).`)

  const rows = await response.json() as { token?: string }[]
  return rows[0]?.token?.trim() ?? ''
}

async function markRecordsSynced(ids: string[], synced: boolean, admin: AdminContext) {
  // Uses the PostgREST API directly so this function has zero external dependencies.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl || ids.length === 0) return

  const response = await fetch(
    `${supabaseUrl}/rest/v1/vinyl_records?id=in.(${ids.join(',')})&collection_owner=eq.${encodeURIComponent(admin.owner)}`,
    {
      method: 'PATCH',
      headers: {
        ...restHeaders(admin),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ discogs_synced_at: synced ? new Date().toISOString() : null }),
    },
  )

  if (!response.ok) {
    console.error('Failed to update discogs_synced_at:', response.status, await response.text())
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const admin = await requireAdmin(request, corsHeaders)
  if (admin instanceof Response) return admin

  try {
    const body = await request.json()
    const action = body.action === 'remove' ? 'remove' : 'add'
    const records: SyncRequestRecord[] = Array.isArray(body.records)
      ? body.records
          .filter((record: unknown): record is SyncRequestRecord =>
            typeof record === 'object'
            && record !== null
            && typeof (record as SyncRequestRecord).id === 'string'
            && /^[\w-]+$/.test((record as SyncRequestRecord).id)
            && Number.isSafeInteger((record as SyncRequestRecord).discogsReleaseId)
            && (record as SyncRequestRecord).discogsReleaseId > 0)
          .slice(0, 200)
      : []

    if (records.length === 0) {
      return jsonResponse({ error: 'No records with a valid discogsReleaseId were provided.' }, 400)
    }

    const discogsToken = await getDiscogsToken(admin)
    if (!discogsToken) {
      return jsonResponse({ error: 'DISCOGS_TOKEN_MISSING: No Discogs token is saved for this account.' }, 422)
    }

    // Only touch records that belong to the caller.
    const ownedIds = await filterOwnedIds(records.map((record) => record.id), admin)
    const results: SyncResult[] = records
      .filter((record) => !ownedIds.has(record.id))
      .map((record): SyncResult => ({ id: record.id, status: 'failed', error: 'Not your record' }))
    const ownedRecords = records.filter((record) => ownedIds.has(record.id))

    const discogsHeaders = {
      Accept: 'application/vnd.discogs.v2.discogs+json',
      'User-Agent': 'Spindex/1.0',
      Authorization: `Discogs token=${discogsToken}`,
    }

    // Resolve the Discogs username from the OAuth identity endpoint.
    const identityResponse = await fetch('https://api.discogs.com/oauth/identity', {
      headers: discogsHeaders,
    })
    if (!identityResponse.ok) {
      // 422 (not 401) so the client can tell a bad Discogs token apart from an expired Spindex session.
      return identityResponse.status === 401
        ? jsonResponse({ error: 'DISCOGS_TOKEN_INVALID: Discogs rejected the saved token.' }, 422)
        : jsonResponse({ error: `Discogs identity check failed (HTTP ${identityResponse.status}).` }, 502)
    }
    const identity = await identityResponse.json()
    const username = typeof identity.username === 'string' ? identity.username : ''
    if (!username) {
      return jsonResponse({ error: 'Could not resolve the Discogs username for this token.' }, 502)
    }

    for (const [index, record] of ownedRecords.entries()) {
      if (index > 0) await sleep(RECORD_DELAY_MS)

      try {
        // Locate the release in the user's collection (also the anti-duplication check).
        const existingResponse = await fetchDiscogs(
          `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/releases/${record.discogsReleaseId}`,
          { headers: discogsHeaders },
        )

        let instanceId: number | null = null
        if (existingResponse.ok) {
          const existing = await existingResponse.json()
          if (Array.isArray(existing.releases) && existing.releases.length > 0) {
            const first = existing.releases[0]
            instanceId = Number.isSafeInteger(first?.instance_id) ? first.instance_id : null
          }
        } else if (existingResponse.status === 404) {
          if (action === 'add') {
            // fall through to the add call below
          } else {
            results.push({ id: record.id, status: 'not_in_collection' })
            continue
          }
        } else {
          results.push({ id: record.id, status: 'failed', error: `Collection check failed (HTTP ${existingResponse.status})` })
          continue
        }

        if (action === 'add') {
          if (instanceId !== null) {
            results.push({ id: record.id, status: 'already_in_collection' })
            continue
          }

          // Not in the collection yet: add to folder 1 ("All").
          const addResponse = await fetchDiscogs(
            `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/folders/1/releases/${record.discogsReleaseId}`,
            { method: 'POST', headers: { ...discogsHeaders, 'Content-Type': 'application/json' }, body: '{}' },
          )

          if (addResponse.ok || addResponse.status === 201) {
            results.push({ id: record.id, status: 'added' })
          } else if (addResponse.status === 404) {
            results.push({ id: record.id, status: 'no_release' })
          } else {
            results.push({ id: record.id, status: 'failed', error: `Add failed (HTTP ${addResponse.status})` })
          }
        } else {
          if (instanceId === null) {
            results.push({ id: record.id, status: 'not_in_collection' })
            continue
          }

          const removeResponse = await fetchDiscogs(
            `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/folders/1/releases/${record.discogsReleaseId}/instances/${instanceId}`,
            { method: 'DELETE', headers: discogsHeaders },
          )

          if (removeResponse.ok || removeResponse.status === 204) {
            results.push({ id: record.id, status: 'removed' })
          } else if (removeResponse.status === 404) {
            results.push({ id: record.id, status: 'not_in_collection' })
          } else {
            results.push({ id: record.id, status: 'failed', error: `Remove failed (HTTP ${removeResponse.status})` })
          }
        }
      } catch (error) {
        results.push({ id: record.id, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }

    // Update discogs_synced_at in the database for the records that changed state.
    const syncedIds = results
      .filter((result) => result.status === 'added' || result.status === 'already_in_collection')
      .map((result) => result.id)
    const removedIds = results
      .filter((result) => result.status === 'removed' || result.status === 'not_in_collection')
      .map((result) => result.id)
    if (syncedIds.length > 0) await markRecordsSynced(syncedIds, true, admin)
    if (removedIds.length > 0) await markRecordsSynced(removedIds, false, admin)

    const summary = {
      added: results.filter((result) => result.status === 'added').length,
      alreadyInCollection: results.filter((result) => result.status === 'already_in_collection').length,
      removed: results.filter((result) => result.status === 'removed').length,
      notInCollection: results.filter((result) => result.status === 'not_in_collection').length,
      noRelease: results.filter((result) => result.status === 'no_release').length,
      failed: results.filter((result) => result.status === 'failed').length,
    }

    return jsonResponse({ username, summary, results })
  } catch (error) {
    console.error('discogs-sync error:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500)
  }
})
