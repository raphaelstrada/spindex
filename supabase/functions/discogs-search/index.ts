import { requireAdmin } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type DiscogsResult = {
  id: number
  title: string
  year?: number | string
  country?: string
  format?: string[]
  label?: string[]
  genre?: string[]
  style?: string[]
  catno?: string
  cover_image?: string
  thumb?: string
  uri?: string
}

type DiscogsReleaseImage = {
  type?: string
  uri?: string
  resource_url?: string
  uri150?: string
}

type DiscogsReleaseFormat = {
  name?: string
  descriptions?: string[]
}

type DiscogsReleaseDetails = {
  id: number
  title: string
  artists?: { name: string }[]
  year?: number | string
  country?: string
  formats?: DiscogsReleaseFormat[]
  labels?: { name: string; catno?: string }[]
  genres?: string[]
  styles?: string[]
  images?: DiscogsReleaseImage[]
  uri?: string
}

// Discogs returns at most 100 results per page. We follow every page; this cap (2,000 releases)
// is only a safety net against runaway searches and the edge function time limit.
const MAX_SEARCH_PAGES = 20

// Extra Discogs requests for the typo round (Discogs allows 60 authenticated requests per minute).
const MAX_TYPO_QUERIES = 8

/** Accent/case-insensitive artist key; drops Discogs disambiguation like "(2)" and "*". */
function normalizeArtist(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\(\d+\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Lowercase, alphanumerics only: "SMAS-3375", "smas 3375" and "SMAS3375" compare equal. */
function normalizeCatno(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Damerau-Levenshtein distance (optimal string alignment): insertions, deletions,
 * substitutions and adjacent transpositions each cost 1. "Raphal" -> "Raphael" = 1.
 */
function editDistance(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, i) => [i, ...Array<number>(right.length).fill(0)])
  for (let j = 1; j <= right.length; j++) rows[0][j] = j
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1)
      }
    }
  }
  return rows[left.length][right.length]
}

/**
 * Ranks a Discogs catalog number against the query. Lower is better; null means no match.
 * Tiers: exact (0) < prefix (1) < contains (2) < approximate/typo (3). Inside a tier the
 * edit distance decides, so closer spellings come first.
 */
function catnoMatchRank(query: string, candidate: string | undefined): [number, number] | null {
  if (!candidate) return null
  const normalizedQuery = normalizeCatno(query)
  // A release can carry several catalog numbers ("ABC-1, ABC-1A"): the best one wins.
  const values = [candidate, ...candidate.split(/\s*[,;/]\s*/)].map(normalizeCatno).filter(Boolean)
  let best: [number, number] | null = null

  for (const value of values) {
    const distance = editDistance(normalizedQuery, value)
    let tier: number | null = null
    if (value === normalizedQuery) tier = 0
    // Partial match: what was typed is the start of / part of the catalog number. A catalog number
    // shorter than the query ("3375" for "SMSA-3375") is not a partial match; edit distance decides.
    else if (value.startsWith(normalizedQuery)) tier = 1
    else if (value.includes(normalizedQuery)) tier = 2
    else {
      // Allow roughly one typo per three characters (at least one).
      const allowed = Math.max(1, Math.round(Math.max(value.length, normalizedQuery.length) / 3))
      if (distance <= allowed) tier = 3
    }
    // Very short queries ("1") would partially match almost everything.
    if ((tier === 1 || tier === 2) && normalizedQuery.length < 3) tier = null
    if (tier !== null && (!best || tier < best[0] || (tier === best[0] && distance < best[1]))) {
      best = [tier, distance]
    }
  }
  return best
}

/**
 * Discogs' own catno search is token based and does not tolerate typos, so several spellings of
 * the query are sent and the merged results are ranked locally with catnoMatchRank.
 */
function catnoQueryVariants(catno: string) {
  const tokens = catno.split(/[^\p{L}\p{N}]+|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u).filter(Boolean)
  // The numeric part ("3375" in "SMAS-3375") is usually the most selective single token.
  const longestToken = [...tokens].sort((left, right) =>
    Number(/\d/.test(right)) - Number(/\d/.test(left)) || right.length - left.length)[0]
  const variants = [catno, tokens.join(' '), tokens.join(''), tokens.join('-')]
  if (tokens.length > 1 && longestToken && longestToken.length >= 3) variants.push(longestToken)
  return [...new Set(variants.filter(Boolean))]
}

/**
 * Typo variants for a second search round: every adjacent transposition of the query, keeping its
 * separators ("SMSA-3375" -> "MSSA-3375", "SSMA-3375", "SMAS-3375", ...). Only used when the first
 * round found no exact match, to stay well under the Discogs rate limit.
 */
function transpositionVariants(catno: string, limit: number) {
  const characters = [...catno]
  const variants: string[] = []
  for (let i = 0; i < characters.length - 1 && variants.length < limit; i++) {
    const [left, right] = [characters[i], characters[i + 1]]
    if (left === right || !/[\p{L}\p{N}]/u.test(left) || !/[\p{L}\p{N}]/u.test(right)) continue
    const swapped = [...characters]
    swapped[i] = right
    swapped[i + 1] = left
    variants.push(swapped.join(''))
  }
  return variants
}

function toRelease(release: DiscogsResult, fallbackArtist: string) {
  const separatorIndex = release.title.lastIndexOf(' - ')
  const releaseArtist = separatorIndex >= 0
    ? release.title.slice(0, separatorIndex).trim()
    : fallbackArtist
  const releaseTitle = separatorIndex >= 0
    ? release.title.slice(separatorIndex + 3).trim()
    : release.title
  const format = release.format ?? []
  const recordType = format.find((item) => ['LP', 'EP', 'Single', 'Box Set'].includes(item)) ?? null
  const recordSize = format.find((item) => /^\d{1,2}["″]$/.test(item)) ?? null

  return {
    id: release.id,
    title: release.title,
    artist: releaseArtist,
    releaseTitle,
    year: release.year && Number.isFinite(Number(release.year)) ? Number(release.year) : null,
    country: release.country ?? null,
    format,
    recordType,
    recordSize,
    label: release.label ?? [],
    genre: release.genre?.[0] ?? null,
    subGenre: release.style?.[0] ?? null,
    catalogNumber: release.catno ?? null,
    coverImage: release.cover_image || release.thumb!,
    thumbnail: release.thumb || release.cover_image!,
    url: new URL(release.uri || `/release/${release.id}`, 'https://www.discogs.com').toString(),
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
    const artist = typeof body.artist === 'string' ? body.artist.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const releaseUrl = typeof body.releaseUrl === 'string' ? body.releaseUrl.trim() : ''
    const priceReleaseId = typeof body.priceReleaseId === 'number' ? body.priceReleaseId : null
    const country = typeof body.country === 'string' ? body.country.trim() : ''
    const year = typeof body.year === 'number' || typeof body.year === 'string'
      ? String(body.year).trim()
      : ''
    const catno = typeof body.catno === 'string' ? body.catno.trim() : ''
    const barcode = typeof body.barcode === 'string' || typeof body.barcode === 'number'
      ? String(body.barcode).replace(/\D/g, '')
      : ''

    if (body.barcode !== undefined && body.barcode !== null && !/^\d{8,14}$/.test(barcode)) {
      return jsonResponse({ error: 'Enter a valid barcode (8 to 14 digits).' }, 400)
    }

    if (body.catno !== undefined && (!normalizeCatno(catno) || catno.length > 50)) {
      return jsonResponse({ error: 'Enter a valid catalog number.' }, 400)
    }

    if ((priceReleaseId === null && !artist && !title && !releaseUrl && !barcode && !catno) || (priceReleaseId !== null && (!Number.isSafeInteger(priceReleaseId) || priceReleaseId <= 0)) || artist.length > 200 || title.length > 200 || releaseUrl.length > 500 || country.length > 100 || (year && !/^\d{4}$/.test(year))) {
      return jsonResponse({ error: 'Provide an artist, an album title, or both.' }, 400)
    }

    const token = Deno.env.get('DISCOGS_TOKEN')
    const consumerKey = Deno.env.get('DISCOGS_CONSUMER_KEY')
    const consumerSecret = Deno.env.get('DISCOGS_CONSUMER_SECRET')
    const hasConsumerCredentials = Boolean(consumerKey && consumerSecret)

    if (!token && !hasConsumerCredentials) {
      return jsonResponse({
        error: 'Discogs is not configured. Add DISCOGS_TOKEN or both consumer key and secret Supabase secrets.',
      }, 503)
    }

    const discogsHeaders = {
      Accept: 'application/vnd.discogs.v2.discogs+json',
      'User-Agent': 'VinylCatalog/1.0',
      Authorization: token
        ? `Discogs token=${token}`
        : `Discogs key=${consumerKey}, secret=${consumerSecret}`,
    }

    if (priceReleaseId !== null) {
      const priceUrl = new URL(`https://api.discogs.com/marketplace/stats/${priceReleaseId}`)
      priceUrl.searchParams.set('curr_abbr', 'USD')
      const priceResponse = await fetch(priceUrl, { headers: discogsHeaders })

      if (!priceResponse.ok) {
        return jsonResponse({ error: `Discogs returned HTTP ${priceResponse.status} for price statistics.` }, priceResponse.status)
      }

      const stats = await priceResponse.json()
      const lowestPrice = typeof stats.lowest_price?.value === 'number' && Number.isFinite(stats.lowest_price.value)
        ? stats.lowest_price.value
        : null

      return jsonResponse({
        lowestPrice,
        currency: stats.lowest_price?.currency ?? 'USD',
        listingsCount: typeof stats.num_for_sale === 'number' ? stats.num_for_sale : null,
      })
    }

    if (releaseUrl) {
      let releaseId: string | null = null
      try {
        const parsedUrl = new URL(releaseUrl)
        if (!['discogs.com', 'www.discogs.com', 'api.discogs.com'].includes(parsedUrl.hostname)) {
          return jsonResponse({ error: 'Enter a valid Discogs release URL.' }, 400)
        }
        releaseId = parsedUrl.pathname.match(/^\/(?:release|releases)\/(\d+)(?:[-/]|$)/)?.[1]
          ?? parsedUrl.pathname.match(/\/release\/(\d+)(?:[-/]|$)/)?.[1]
          ?? null
      } catch {
        return jsonResponse({ error: 'Enter a valid Discogs release URL.' }, 400)
      }

      if (!releaseId) {
        return jsonResponse({ error: 'Enter a Discogs release URL, not a search or master URL.' }, 400)
      }

      const releaseResponse = await fetch(`https://api.discogs.com/releases/${releaseId}`, {
        headers: discogsHeaders,
      })

      if (!releaseResponse.ok) {
        if (releaseResponse.status === 401 || releaseResponse.status === 403) {
          return jsonResponse({ error: 'Discogs rejected the configured credentials. Check the Supabase function secrets.' }, 502)
        }
        return jsonResponse({ error: `Discogs returned HTTP ${releaseResponse.status}.` }, releaseResponse.status)
      }

      const release = await releaseResponse.json() as DiscogsReleaseDetails
      const image = release.images?.find((item) => item.type === 'primary') ?? release.images?.[0]
      const coverImage = image?.uri ?? image?.resource_url
      if (!coverImage) return jsonResponse({ results: [] })

      const formats = release.formats ?? []
      const formatValues = formats.flatMap((item) => [item.name, ...(item.descriptions ?? [])].filter((value): value is string => Boolean(value)))
      const descriptions = formats.flatMap((item) => item.descriptions ?? [])
      const recordType = descriptions.find((value) => ['LP', 'EP', 'Single', 'Box Set'].includes(value)) ?? null
      const recordSize = descriptions.find((value) => /^\d{1,2}["″]$/.test(value)) ?? null
      const releaseArtist = release.artists?.map((item) => item.name).filter(Boolean).join(', ') || artist

      return jsonResponse({
        results: [{
          id: release.id,
          title: `${releaseArtist} - ${release.title}`,
          artist: releaseArtist,
          releaseTitle: release.title,
          year: release.year && Number.isFinite(Number(release.year)) ? Number(release.year) : null,
          country: release.country ?? null,
          format: formatValues,
          recordType,
          recordSize,
          label: release.labels?.map((item) => item.name).filter(Boolean) ?? [],
          genre: release.genres?.[0] ?? null,
          subGenre: release.styles?.[0] ?? null,
          catalogNumber: release.labels?.[0]?.catno ?? null,
          coverImage,
          thumbnail: image?.uri150 ?? coverImage,
          url: release.uri ?? `https://www.discogs.com/release/${release.id}`,
        }],
      })
    }

    if (catno) {
      const searchVariant = async (param: 'catno' | 'q', value: string, artistHint = '') => {
        const url = new URL('https://api.discogs.com/database/search')
        url.searchParams.set('type', 'release')
        url.searchParams.set('format', 'Vinyl')
        url.searchParams.set(param, value)
        if (artistHint) url.searchParams.set('artist', artistHint)
        url.searchParams.set('per_page', '100')
        const response = await fetch(url, { headers: discogsHeaders })
        if (!response.ok) {
          await response.body?.cancel()
          return { status: response.status, results: [] as DiscogsResult[] }
        }
        const payload = await response.json()
        return { status: response.status, results: (payload.results as DiscogsResult[] | undefined) ?? [] }
      }

      const responses = await Promise.all([
        ...catnoQueryVariants(catno).map((variant) => searchVariant('catno', variant)),
        searchVariant('q', catno),
        // Short Cat#s (e.g. "1403") are shared by hundreds of releases and the 100 results of a plain
        // search may not include the right one. When the artist is known, ask for it explicitly too.
        ...(artist ? [searchVariant('catno', catno, artist)] : []),
      ])

      const hasExactMatch = responses.some((response) =>
        response.results.some((release) => catnoMatchRank(catno, release.catno)?.[0] === 0))
      if (!hasExactMatch) {
        responses.push(...await Promise.all(
          transpositionVariants(catno, MAX_TYPO_QUERIES).map((variant) => searchVariant('catno', variant)),
        ))
      }

      if (responses.every((response) => response.status !== 200)) {
        const status = responses[0].status
        if (status === 401 || status === 403) {
          return jsonResponse({ error: 'Discogs rejected the configured credentials. Check the Supabase function secrets.' }, 502)
        }
        return jsonResponse({ error: `Discogs returned HTTP ${status}.` }, status)
      }

      const artistKey = normalizeArtist(artist)
      const ranked = [...new Map(responses.flatMap((response) => response.results).map((release) => [release.id, release])).values()]
        .filter((release) => release.cover_image || release.thumb)
        .map((release, order) => {
          const candidate = toRelease(release, '')
          const candidateKey = normalizeArtist(candidate.artist)
          const artistMatch = Boolean(artistKey && candidateKey && (candidateKey.includes(artistKey) || artistKey.includes(candidateKey)))
          return { candidate, artistMatch, order, rank: catnoMatchRank(catno, release.catno) }
        })
        .filter((item): item is typeof item & { rank: [number, number] } => item.rank !== null)
        // Same artist first, then exact, prefix, contains and typo matches; Discogs relevance breaks ties.
        .sort((left, right) => Number(right.artistMatch) - Number(left.artistMatch)
          || left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || left.order - right.order)

      return jsonResponse({
        results: ranked.map(({ candidate, artistMatch, rank }) => ({ ...candidate, artistMatch, matchTier: rank[0], matchDistance: rank[1] })),
      })
    }

    const searchUrl = new URL('https://api.discogs.com/database/search')
    searchUrl.searchParams.set('type', 'release')
    if (artist) searchUrl.searchParams.set('artist', artist)
    if (title) searchUrl.searchParams.set('release_title', title)
    if (country) searchUrl.searchParams.set('country', country)
    if (year) searchUrl.searchParams.set('year', year)
    if (barcode) searchUrl.searchParams.set('barcode', barcode)
    searchUrl.searchParams.set('format', 'Vinyl')
    searchUrl.searchParams.set('per_page', '100') // Discogs maximum

    const fetchSearchPage = (page: number) => {
      searchUrl.searchParams.set('page', String(page))
      return fetch(searchUrl, { headers: discogsHeaders })
    }

    const discogsResponse = await fetchSearchPage(1)

    if (!discogsResponse.ok) {
      if (discogsResponse.status === 401 || discogsResponse.status === 403) {
        return jsonResponse({ error: 'Discogs rejected the configured credentials. Check the Supabase function secrets.' }, 502)
      }
      return jsonResponse({ error: `Discogs returned HTTP ${discogsResponse.status}.` }, discogsResponse.status)
    }

    const payload = await discogsResponse.json()
    const allReleases: DiscogsResult[] = [...((payload.results as DiscogsResult[] | undefined) ?? [])]
    const totalPages = Number(payload.pagination?.pages) || 1

    // Collect every remaining page. If a later page fails (e.g. Discogs rate limit), return what we
    // already have instead of failing the whole search.
    for (let page = 2; page <= Math.min(totalPages, MAX_SEARCH_PAGES); page++) {
      const pageResponse = await fetchSearchPage(page)
      if (!pageResponse.ok) {
        console.warn(`Discogs search page ${page} failed with HTTP ${pageResponse.status}; returning partial results.`)
        await pageResponse.body?.cancel()
        break
      }
      const pagePayload = await pageResponse.json()
      allReleases.push(...((pagePayload.results as DiscogsResult[] | undefined) ?? []))
    }

    const results = [...new Map(allReleases.map((release) => [release.id, release])).values()]
      .filter((release) => release.cover_image || release.thumb)
      .map((release) => toRelease(release, artist))

    return jsonResponse({ results })
  } catch (error) {
    console.error('Discogs search failed:', error)
    return jsonResponse({ error: 'Unable to search Discogs right now.' }, 500)
  }
})