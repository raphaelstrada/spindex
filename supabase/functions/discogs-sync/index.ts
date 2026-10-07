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

async function markRecordsSynced(ids: string[], synced: boolean) {
  // Uses the PostgREST API directly so this function has zero external dependencies.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey || ids.length === 0) return

  const response = await fetch(
    `${supabaseUrl}/rest/v1/vinyl_records?id=in.(${ids.join(',')})`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
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

  try {
    const body = await request.json()
    const action = body.action === 'remove' ? 'remove' : 'add'
    const discogsToken = typeof body.discogsToken === 'string' ? body.discogsToken.trim() : ''
    const records: SyncRequestRecord[] = Array.isArray(body.records)
      ? body.records
          .filter((record: unknown): record is SyncRequestRecord =>
            typeof record === 'object'
            && record !== null
            && typeof (record as SyncRequestRecord).id === 'string'
            && Number.isSafeInteger((record as SyncRequestRecord).discogsReleaseId)
            && (record as SyncRequestRecord).discogsReleaseId > 0)
          .slice(0, 200)
      : []

    if (!discogsToken) {
      return jsonResponse({ error: 'Missing Discogs personal access token.' }, 400)
    }
    if (records.length === 0) {
      return jsonResponse({ error: 'No records with a valid discogsReleaseId were provided.' }, 400)
    }

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
      return jsonResponse({
        error: `Discogs rejected the token (HTTP ${identityResponse.status}). Check your personal access token.`,
      }, identityResponse.status === 401 ? 401 : 502)
    }
    const identity = await identityResponse.json()
    const username = typeof identity.username === 'string' ? identity.username : ''
    if (!username) {
      return jsonResponse({ error: 'Could not resolve the Discogs username for this token.' }, 502)
    }

    const results: SyncResult[] = []

    for (const [index, record] of records.entries()) {
      if (index > 0) await sleep(1100) // stay under the Discogs rate limit (60 req/min)

      try {
        // Locate the release in the user's collection (also the anti-duplication check).
        const existingResponse = await fetch(
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
          const addResponse = await fetch(
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

          const removeResponse = await fetch(
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
    if (syncedIds.length > 0) await markRecordsSynced(syncedIds, true)
    if (removedIds.length > 0) await markRecordsSynced(removedIds, false)

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
