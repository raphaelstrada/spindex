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
