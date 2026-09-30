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
  return data?.results ?? []
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