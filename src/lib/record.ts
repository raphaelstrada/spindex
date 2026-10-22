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
  created_at?: string | null
  [key: string]: unknown
}