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

  try {
    const body = await request.json()
    const artist = typeof body.artist === 'string' ? body.artist.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const releaseUrl = typeof body.releaseUrl === 'string' ? body.releaseUrl.trim() : ''
    const priceReleaseId = typeof body.priceReleaseId === 'number' ? body.priceReleaseId : null
    const barcode = typeof body.barcode === 'string' ? body.barcode.trim() : ''
    const country = typeof body.country === 'string' ? body.country.trim() : ''
    const year = typeof body.year === 'number' || typeof body.year === 'string'
      ? String(body.year).trim()
      : ''

    if ((priceReleaseId === null && !artist && !title && !releaseUrl && !barcode) || (priceReleaseId !== null && (!Number.isSafeInteger(priceReleaseId) || priceReleaseId <= 0)) || artist.length > 200 || title.length > 200 || releaseUrl.length > 500 || barcode.length > 50 || country.length > 100 || (year && !/^\d{4}$/.test(year))) {
      return jsonResponse({ error: 'Provide an artist, an album title, a release URL, or a barcode.' }, 400)
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
      'User-Agent': 'Spindex/1.0',
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

    const searchUrl = new URL('https://api.discogs.com/database/search')
    searchUrl.searchParams.set('type', 'release')
    if (artist) searchUrl.searchParams.set('artist', artist)
    if (title) searchUrl.searchParams.set('release_title', title)
    if (barcode) searchUrl.searchParams.set('barcode', barcode)
    if (country) searchUrl.searchParams.set('country', country)
    if (year) searchUrl.searchParams.set('year', year)
    searchUrl.searchParams.set('format', 'Vinyl')
    searchUrl.searchParams.set('per_page', '50')

    const discogsResponse = await fetch(searchUrl, { headers: discogsHeaders })

    if (!discogsResponse.ok) {
      if (discogsResponse.status === 401 || discogsResponse.status === 403) {
        return jsonResponse({ error: 'Discogs rejected the configured credentials. Check the Supabase function secrets.' }, 502)
      }
      return jsonResponse({ error: `Discogs returned HTTP ${discogsResponse.status}.` }, discogsResponse.status)
    }

    const payload = await discogsResponse.json()
    const results = (payload.results as DiscogsResult[] ?? [])
      .filter((release) => release.cover_image || release.thumb)
      .map((release) => {
        const separatorIndex = release.title.lastIndexOf(' - ')
        const releaseArtist = separatorIndex >= 0
          ? release.title.slice(0, separatorIndex).trim()
          : artist
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
      })

    return jsonResponse({ results })
  } catch (error) {
    console.error('Discogs search failed:', error)
    return jsonResponse({ error: 'Unable to search Discogs right now.' }, 500)
  }
})