export type VinylRecord = {
  id: string
  collection_owner?: string | null
  artist: string | null
  title: string | null
  year_pressed: number | null
  genre: string | null
  image_url: string | null
  original_image_url?: string | null
  source_url?: string | null
  record_label?: string | null
  record_group?: string | null
  catalog_number?: string | null
  sub_genre?: string | null
  record_type?: string | null
  record_size?: string | null
  country_pressed?: string | null
  media_condition?: string | null
  sleeve_condition?: string | null
  is_original?: boolean | null
  is_special_edition?: boolean | null
  special_edition_reason?: string | null
  sell_possibility?: boolean | null
  sold?: boolean | null
  discogs_lowest_price?: number | null
  discogs_market_price?: number | null
  discogs_market_currency?: string | null
  discogs_market_condition?: string | null
  discogs_num_for_sale?: number | null
  discogs_market_checked_at?: string | null
  price_on_discogs?: number | null
  discogs_synced_at?: string | null
  marketplace_price?: number | null
  /** Computed by record_sale_price_cad (the store price), read-only. */
  sale_price_cad?: number | null
  marketplace_currency?: string | null
  notes?: string | null
  discogs_link?: string | null
  /** Automatic match by artist + album. Null = not processed, or confirmed by the admin. */
  discogs_auto_match?: 'provisional' | 'ambiguous' | 'no_match' | null
  discogs_auto_match_score?: number | null
  discogs_auto_matched_at?: string | null
  /** The cover came from the first Discogs search result, not from a matched release. */
  discogs_auto_cover?: boolean | null
  spotify_album_id?: string | null
  spotify_matched_at?: string | null
  created_at?: string | null
  [key: string]: unknown
}
// Mirrors the public_catalog filter; only drives non-blocking warnings and admin stats.
export function storeExclusion(record: VinylRecord): 'sold' | 'notForSale' | 'noPrice' | null {
  if (record.sold) return 'sold'
  if (!record.sell_possibility) return 'notForSale'
  if (record.marketplace_price == null && record.price_on_discogs == null) return 'noPrice'
  return null
}

/** A record counts as on Facebook Marketplace once it has a listing URL or a Marketplace price. */
export function isOnFacebookMarketplace(record: VinylRecord) {
  return Boolean(record.source_url?.includes('facebook.com')) || record.marketplace_price != null
}

/** The Discogs link and cover are a guess until the admin picks a release: no prices, syncs or checks from them. */
export function isAutoMatched(record: Pick<VinylRecord, 'discogs_auto_match' | 'discogs_auto_cover'> | null | undefined) {
  return Boolean(record?.discogs_auto_match || record?.discogs_auto_cover)
}

export const NO_AUTO_MATCH = {
  discogs_auto_match: null,
  discogs_auto_match_score: null,
  discogs_auto_matched_at: null,
  discogs_auto_cover: false,
}

/** Loose text for matching names across Discogs/Spotify: no accents, case, punctuation or "and". */
export function normalizeMatchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
