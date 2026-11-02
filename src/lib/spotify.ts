import { normalizeMatchText, type VinylRecord } from '@/lib/record'
import { showSetupIssue } from '@/lib/setupIssues'

// Authorization Code + PKCE, entirely in the browser: no client secret exists anywhere.
// The Spotify tokens stay in this browser (per admin owner) and are never sent to Supabase.
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
const API = 'https://api.spotify.com/v1'
const SCOPES = 'playlist-modify-private playlist-read-private user-library-modify'
const PKCE_KEY = 'spindex-spotify-pkce'
export const SPOTIFY_PLAYLIST_NAME = 'Spindex – My vinyl'

type StoredToken = { accessToken: string; refreshToken: string; expiresAt: number }

export function isSpotifyConfigured() {
  return Boolean(CLIENT_ID)
}

function tokenKey(owner: string) {
  return `spindex-spotify-token-${owner}`
}

function readToken(owner: string): StoredToken | null {
  try {
    const raw = window.localStorage.getItem(tokenKey(owner))
    return raw ? JSON.parse(raw) as StoredToken : null
  } catch {
    return null
  }
}

function writeToken(owner: string, token: StoredToken | null) {
  try {
    if (token) window.localStorage.setItem(tokenKey(owner), JSON.stringify(token))
    else window.localStorage.removeItem(tokenKey(owner))
  } catch {
    // Without storage the admin just has to connect again.
  }
}

export function isSpotifyConnected(owner: string) {
  return readToken(owner) !== null
}

export function disconnectSpotify(owner: string) {
  writeToken(owner, null)
}

// Spotify must have this exact URL registered as a redirect URI.
export function spotifyRedirectUri() {
  return `${window.location.origin}${import.meta.env.BASE_URL}admin`
}

/** Spotify rejects "localhost" redirect URIs; locally the admin must run on 127.0.0.1. */
export function isOnLocalhost() {
  return window.location.hostname === 'localhost'
}

export function loopbackAdminUrl() {
  const url = new URL(window.location.href)
  url.hostname = '127.0.0.1'
  return url.href
}

function randomString(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[byte % 62]).join('')
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function connectSpotify(owner: string) {
  if (!CLIENT_ID) throw new Error('SPOTIFY_NOT_CONFIGURED')
  const verifier = randomString(64)
  const state = randomString(16)
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, owner }))
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    scope: SCOPES,
    state,
  })
  window.location.assign(`https://accounts.spotify.com/authorize?${params}`)
}

async function requestToken(body: Record<string, string>): Promise<Omit<StoredToken, 'refreshToken'> & { refreshToken?: string }> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID ?? '', ...body }),
  })
  if (!response.ok) throw new Error(`Spotify login failed (HTTP ${response.status}).`)
  const payload = await response.json() as { access_token: string; refresh_token?: string; expires_in: number }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in - 60) * 1000,
  }
}

/** Finishes the login when Spotify redirects back with ?code=&state=. Returns true when it handled a callback. */
export async function completeSpotifyLogin(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const spotifyError = params.get('error')
  if (!state || (!code && !spotifyError)) return false

  let pending: { verifier: string; state: string; owner: string } | null
  try {
    pending = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null')
  } catch {
    pending = null
  }
  sessionStorage.removeItem(PKCE_KEY)
  window.history.replaceState(null, '', window.location.pathname)

  if (!pending || pending.state !== state) return false
  if (spotifyError || !code) throw new Error(`Spotify login was cancelled (${spotifyError ?? 'no code'}).`)

  const token = await requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: spotifyRedirectUri(),
    code_verifier: pending.verifier,
  })
  if (!token.refreshToken) throw new Error('Spotify did not return a refresh token.')
  writeToken(pending.owner, { ...token, refreshToken: token.refreshToken })
  return true
}

async function accessToken(owner: string, forceRefresh = false) {
  const token = readToken(owner)
  if (!token) throw new Error('SPOTIFY_NOT_CONNECTED')
  if (!forceRefresh && token.expiresAt > Date.now()) return token.accessToken

  try {
    const refreshed = await requestToken({ grant_type: 'refresh_token', refresh_token: token.refreshToken })
    // Spotify may or may not rotate the refresh token.
    writeToken(owner, { ...refreshed, refreshToken: refreshed.refreshToken ?? token.refreshToken })
    return refreshed.accessToken
  } catch {
    writeToken(owner, null)
    throw new Error('SPOTIFY_NOT_CONNECTED')
  }
}

/**
 * True when Spotify can be used right now. Otherwise explains what is missing in the setup dialog
 * (Client ID, 127.0.0.1 instead of localhost, connecting the account) and returns false.
 */
export async function ensureSpotifyReady(owner: string) {
  if (isSpotifyConfigured() && isSpotifyConnected(owner)) return true
  if (!isSpotifyConfigured()) {
    await showSetupIssue('spotifyNotConfigured')
  } else if (isOnLocalhost()) {
    if (await showSetupIssue('spotifyWrongHost') === true) window.location.assign(loopbackAdminUrl())
  } else if (await showSetupIssue('spotifyConnect') === true) {
    await connectSpotify(owner)
  }
  return false
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function spotifyFetch<T>(owner: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await accessToken(owner, attempt === 1)
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })

  if (response.status === 401 && attempt === 0) return spotifyFetch(owner, path, init, 1)
  if (response.status === 429 && attempt < 4) {
    await wait((Number(response.headers.get('Retry-After')) || 2) * 1000)
    return spotifyFetch(owner, path, init, attempt + 2)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Spotify HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  const text = await response.text()
  return (text ? JSON.parse(text) : null) as T
}

export function spotifyAlbumUrl(albumId: string) {
  return `https://open.spotify.com/album/${albumId}`
}

/** Accepts an album URL (open.spotify.com/album/ID), a URI (spotify:album:ID) or a bare ID. */
export function parseSpotifyAlbumId(value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  const match = text.match(/(?:album[/:])([A-Za-z0-9]{22})/) ?? text.match(/^([A-Za-z0-9]{22})$/)
  return match?.[1] ?? null
}

type SpotifyAlbum = { id: string; name: string; album_type: string; release_date?: string; artists: { name: string }[] }

/** Exact artist + title match only (never a guess); prefers the record's year, then real albums. */
export async function matchSpotifyAlbum(owner: string, record: VinylRecord): Promise<string | null> {
  if (!record.artist || !record.title) return null
  const query = `album:"${record.title.replace(/"/g, '')}" artist:"${record.artist.replace(/"/g, '')}"`
  const result = await spotifyFetch<{ albums: { items: SpotifyAlbum[] } }>(
    owner,
    `/search?${new URLSearchParams({ q: query, type: 'album', limit: '10' })}`,
  )
  const artist = normalizeMatchText(record.artist)
  const title = normalizeMatchText(record.title)
  const matches = (result.albums?.items ?? []).filter((album) =>
    normalizeMatchText(album.name) === title
    && album.artists.some((albumArtist) => normalizeMatchText(albumArtist.name) === artist),
  )
  const score = (album: SpotifyAlbum) =>
    Number(record.year_pressed != null && album.release_date?.startsWith(String(record.year_pressed))) * 2
    + Number(album.album_type === 'album')
  matches.sort((left, right) => score(right) - score(left))
  return matches[0]?.id ?? null
}

/** Saves albums to "Your Library" (max 40 URIs per call). */
export async function saveAlbumsToLibrary(owner: string, albumIds: string[]) {
  for (let index = 0; index < albumIds.length; index += 40) {
    const uris = albumIds.slice(index, index + 40).map((id) => `spotify:album:${id}`).join(',')
    await spotifyFetch(owner, `/me/library?${new URLSearchParams({ uris })}`, { method: 'PUT' })
  }
}

async function albumTrackUris(owner: string, albumId: string) {
  const uris: string[] = []
  let next: string | null = `/albums/${albumId}/tracks?limit=50`
  while (next) {
    const page: { items: { uri: string }[]; next: string | null } = await spotifyFetch(owner, next)
    uris.push(...page.items.map((track) => track.uri))
    next = page.next
  }
  return uris
}

async function findOrCreatePlaylist(owner: string) {
  let next: string | null = '/me/playlists?limit=50'
  while (next) {
    const page: { items: { id: string; name: string }[]; next: string | null } = await spotifyFetch(owner, next)
    const existing = page.items.find((playlist) => playlist?.name === SPOTIFY_PLAYLIST_NAME)
    if (existing) return existing.id
    next = page.next
  }
  const created = await spotifyFetch<{ id: string }>(owner, '/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name: SPOTIFY_PLAYLIST_NAME, public: false, description: 'Every record in my Spindex vinyl collection.' }),
  })
  return created.id
}

/** Replaces the Spindex playlist content with every track of the given albums (no duplicates on re-sync). */
export async function syncPlaylist(owner: string, albumIds: string[], onProgress?: (current: number, total: number) => void) {
  const uris: string[] = []
  for (const [index, albumId] of albumIds.entries()) {
    onProgress?.(index + 1, albumIds.length)
    uris.push(...await albumTrackUris(owner, albumId))
  }
  const playlistId = await findOrCreatePlaylist(owner)
  // PUT replaces everything with the first 100 items; the rest are appended.
  await spotifyFetch(owner, `/playlists/${playlistId}/items`, { method: 'PUT', body: JSON.stringify({ uris: uris.slice(0, 100) }) })
  for (let index = 100; index < uris.length; index += 100) {
    await spotifyFetch(owner, `/playlists/${playlistId}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(index, index + 100) }) })
  }
  return { playlistUrl: `https://open.spotify.com/playlist/${playlistId}`, trackCount: uris.length }
}

export type SpotifyAlbumCandidate = {
  id: string
  name: string
  artists: string
  year: number | null
  albumType: string
  totalTracks: number | null
  image: string | null
  url: string
  /** Same artist and title as the record (after normalizing). */
  exactMatch: boolean
}

type SpotifySearchAlbum = SpotifyAlbum & { total_tracks?: number; images?: { url: string; width?: number }[]; external_urls?: { spotify?: string } }

/** Probable albums for the record picker: exact artist + title matches first, then the record's year. */
export async function searchSpotifyAlbums(owner: string, artist: string, title: string, year?: number | null): Promise<SpotifyAlbumCandidate[]> {
  const search = async (q: string) => (await spotifyFetch<{ albums: { items: SpotifySearchAlbum[] } }>(
    owner,
    `/search?${new URLSearchParams({ q, type: 'album', limit: '10' })}`,
  )).albums?.items ?? []

  const cleanArtist = artist.replace(/"/g, '').trim()
  const cleanTitle = title.replace(/"/g, '').trim()
  // Field filters are precise but strict; fall back to free text when they find nothing.
  let albums = cleanArtist && cleanTitle ? await search(`album:"${cleanTitle}" artist:"${cleanArtist}"`) : []
  if (albums.length === 0) albums = await search(`${cleanArtist} ${cleanTitle}`.trim())

  const normalizedArtist = normalizeMatchText(artist)
  const normalizedTitle = normalizeMatchText(title)
  const candidates = albums.filter(Boolean).map((album) => {
    const releaseYear = Number(album.release_date?.slice(0, 4))
    return {
      id: album.id,
      name: album.name,
      artists: album.artists.map((albumArtist) => albumArtist.name).join(', '),
      year: Number.isFinite(releaseYear) && releaseYear > 0 ? releaseYear : null,
      albumType: album.album_type,
      totalTracks: album.total_tracks ?? null,
      // Spotify lists images largest first; the smallest one above 64px is enough for a thumbnail.
      image: [...(album.images ?? [])].reverse().find((image) => (image.width ?? 300) >= 64)?.url ?? album.images?.[0]?.url ?? null,
      url: album.external_urls?.spotify ?? spotifyAlbumUrl(album.id),
      exactMatch: normalizeMatchText(album.name) === normalizedTitle
        && album.artists.some((albumArtist) => normalizeMatchText(albumArtist.name) === normalizedArtist),
    }
  })
  const score = (candidate: SpotifyAlbumCandidate) =>
    Number(candidate.exactMatch) * 4 + Number(year != null && candidate.year === year) * 2 + Number(candidate.albumType === 'album')
  // Stable sort keeps Spotify's relevance order inside each score.
  return candidates.sort((left, right) => score(right) - score(left))
}

async function playlistTrackUris(owner: string, playlistId: string) {
  const uris = new Set<string>()
  let next: string | null = `/playlists/${playlistId}/items?${new URLSearchParams({ limit: '50', fields: 'items(item(uri)),next' })}`
  while (next) {
    const page: { items?: { item?: { uri?: string } | null }[]; next: string | null } = await spotifyFetch(owner, next)
    for (const entry of page.items ?? []) if (entry.item?.uri) uris.add(entry.item.uri)
    next = page.next
  }
  return uris
}

/**
 * After a record's Spotify album is saved: adds the album to "Your Library" and its missing tracks to
 * the Spindex playlist. When the record pointed to another album before (and no other record uses
 * it), that album is removed from both, so the playlist keeps mirroring the collection.
 */
export async function syncRecordAlbum(owner: string, albumId: string | null, previousAlbumId: string | null, previousStillUsed: boolean) {
  const playlistId = await findOrCreatePlaylist(owner)

  if (previousAlbumId && previousAlbumId !== albumId && !previousStillUsed) {
    const oldTracks = await albumTrackUris(owner, previousAlbumId)
    for (let index = 0; index < oldTracks.length; index += 100) {
      await spotifyFetch(owner, `/playlists/${playlistId}/items`, {
        method: 'DELETE',
        body: JSON.stringify({ items: oldTracks.slice(index, index + 100).map((uri) => ({ uri })) }),
      })
    }
    await spotifyFetch(owner, `/me/library?${new URLSearchParams({ uris: `spotify:album:${previousAlbumId}` })}`, { method: 'DELETE' })
  }

  if (!albumId) return
  await saveAlbumsToLibrary(owner, [albumId])
  const existing = await playlistTrackUris(owner, playlistId)
  const missing = (await albumTrackUris(owner, albumId)).filter((uri) => !existing.has(uri))
  for (let index = 0; index < missing.length; index += 100) {
    await spotifyFetch(owner, `/playlists/${playlistId}/items`, { method: 'POST', body: JSON.stringify({ uris: missing.slice(index, index + 100) }) })
  }
}
