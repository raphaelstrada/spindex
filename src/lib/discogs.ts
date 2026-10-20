import { supabase } from '@/lib/supabase'

export type DiscogsRelease = {
  id: number
  title: string
  artist: string
  releaseTitle: string
  year: number | null
  country: string | null
  format: string[]
  recordType: string | null
  recordSize: string | null
  label: string[]
  genre: string | null
  subGenre: string | null
  catalogNumber: string | null
  coverImage: string
  thumbnail: string
  url: string
  lowestPrice?: number | null
  priceCurrency?: string
  listingsCount?: number | null
}

export type DiscogsPriceStats = {
  lowestPrice: number | null
  currency: string
  listingsCount: number | null
}

export type DiscogsSearchFilters = {
  country?: string
  year?: number
}

const EUROPEAN_COUNTRIES = new Set([
  'uk', 'united kingdom', 'england', 'scotland', 'wales', 'northern ireland', 'ireland', 'germany',
  'east germany', 'west germany', 'france', 'italy', 'spain', 'portugal', 'netherlands', 'belgium',
  'luxembourg', 'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'iceland', 'poland',
  'czech republic', 'czech', 'czechoslovakia', 'slovakia', 'hungary', 'romania', 'bulgaria', 'greece',
  'yugoslavia', 'serbia', 'croatia', 'slovenia', 'bosnia', 'herzegovina', 'montenegro', 'macedonia',
  'north macedonia', 'albania', 'estonia', 'latvia', 'lithuania', 'ukraine', 'belarus', 'moldova', 'malta',
  'cyprus', 'monaco', 'andorra', 'liechtenstein', 'san marino', 'scandinavia', 'benelux', 'faroe islands',
])

/**
 * Pressing-country priority: Canada, Brazil, US, Europe, everything else, unknown last.
 * Discogs also uses combined values such as "UK & Europe" or "US & Canada": the best part wins.
 */
export function countryRank(country: string | null | undefined): number {
  if (!country) return 5
  const parts = country
    .toLowerCase()
    .replace(/\(historic\)/g, '')
    .split(/\s*(?:,|&|\/|\band\b)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)

  let best = 4
  for (const part of parts) {
    let rank = 4
    if (part === 'canada') rank = 0
    else if (part === 'brazil' || part === 'brasil') rank = 1
    else if (['us', 'usa', 'u.s.a.', 'united states', 'united states of america'].includes(part)) rank = 2
    else if (part === 'europe') rank = 3
    else if (EUROPEAN_COUNTRIES.has(part)) rank = 3.5
    best = Math.min(best, rank)
  }
  return best
}

/** Stable sort: inside each country group, Discogs' own relevance order is kept. */
export function sortReleasesByCountryPriority<T extends { country: string | null }>(releases: T[]): T[] {
  return [...releases].sort((left, right) => countryRank(left.country) - countryRank(right.country))
}

export function getDiscogsReleaseId(value: string | null | undefined): number | null {
  if (!value) return null

  try {
    const url = new URL(value)
    if (!/(^|\.)discogs\.com$/i.test(url.hostname)) return null

    const match = url.pathname.match(/\/(?:releases?\/(\d+)|discogs-images\/R-(\d+)-)/i)
    const id = Number(match?.[1] ?? match?.[2])
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

export async function searchDiscogsReleases(
  artist: string,
  title: string,
  releaseUrl?: string,
  filters?: DiscogsSearchFilters,
) {
  const { data, error } = await supabase.functions.invoke<{ results: DiscogsRelease[] }>(
    'discogs-search',
    { body: { artist, title, releaseUrl, ...filters } },
  )

  if (error) {
    if (error.context instanceof Response) {
      const details = await error.context.json().catch(() => null) as { error?: string } | null
      throw new Error(details?.error || error.message)
    }
    throw new Error(error.message)
  }
  return sortReleasesByCountryPriority(data?.results ?? [])
}

/** Keeps only digits (removes spaces, dashes, etc.). */
export function normalizeBarcode(raw: string): string {
  return raw.replace(/\D/g, '')
}

/**
 * UPC-A (12 digits) and EAN-13 (13 digits starting with 0) are the same product,
 * but Discogs may have stored either form. Try both.
 */
export function barcodeVariants(raw: string): string[] {
  const code = normalizeBarcode(raw)
  const variants = new Set<string>([code])
  if (code.length === 13 && code.startsWith('0')) variants.add(code.slice(1))
  if (code.length === 12) variants.add(`0${code}`)
  return [...variants]
}

export async function searchDiscogsByBarcode(barcode: string): Promise<DiscogsRelease[]> {
  for (const code of barcodeVariants(barcode)) {
    const { data, error } = await supabase.functions.invoke<{ results: DiscogsRelease[] }>(
      'discogs-search',
      { body: { barcode: code } },
    )

    if (error) throw await extractFunctionError(error, 'discogs-search')
    if (data?.results?.length) return sortReleasesByCountryPriority(data.results)
  }
  return []
}

export async function getDiscogsLowestPrice(releaseId: number): Promise<DiscogsPriceStats> {
  const { data, error } = await supabase.functions.invoke<DiscogsPriceStats>(
    'discogs-search',
    { body: { priceReleaseId: releaseId } },
  )

  if (error) {
    if (error.context instanceof Response) {
      const details = await error.context.json().catch(() => null) as { error?: string } | null
      throw new Error(details?.error || error.message)
    }
    throw new Error(error.message)
  }

  return data ?? { lowestPrice: null, currency: 'USD', listingsCount: null }
}

export type DiscogsSyncResult = {
  id: string
  status: 'added' | 'already_in_collection' | 'removed' | 'not_in_collection' | 'no_release' | 'failed'
  error?: string
}

export type DiscogsSyncResponse = {
  username: string
  summary: {
    added: number
    alreadyInCollection: number
    removed: number
    notInCollection: number
    noRelease: number
    failed: number
  }
  results: DiscogsSyncResult[]
}

async function extractFunctionError(error: unknown, functionName: string): Promise<Error> {
  // The function was invoked and returned an HTTP error: read status + body.
  const context = (error as { context?: unknown } | null)?.context
  if (context instanceof Response) {
    const status = context.status
    const rawBody = await context.clone().text().catch(() => '')
    let detail = rawBody
    try {
      const parsed = JSON.parse(rawBody) as { error?: string }
      if (parsed?.error) detail = parsed.error
    } catch {
      // keep raw body
    }

    if (status === 404) {
      return new Error(
        `[${functionName}] HTTP 404: function not deployed. Run "supabase functions deploy ${functionName}". ${detail}`.trim(),
      )
    }
    return new Error(`[${functionName}] HTTP ${status}: ${detail || 'no response body'}`)
  }

  // Network-level failure (CORS, DNS, function unreachable).
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new Error(
      `[${functionName}] Network/CORS error: could not reach the function. Check that it is deployed and the Supabase URL is correct. (${message})`,
    )
  }

  return error instanceof Error ? error : new Error(message)
}

export async function syncRecordsToDiscogs(
  discogsToken: string,
  records: { id: string; discogsReleaseId: number }[],
  action: 'add' | 'remove' = 'add',
): Promise<DiscogsSyncResponse> {
  const { data, error } = await supabase.functions.invoke<DiscogsSyncResponse>(
    'discogs-sync',
    { body: { discogsToken, records, action } },
  )

  if (error) {
    console.error('discogs-sync invoke error (raw):', error)
    throw await extractFunctionError(error, 'discogs-sync')
  }

  if (!data) throw new Error('[discogs-sync] Empty response from the function.')
  return data
}