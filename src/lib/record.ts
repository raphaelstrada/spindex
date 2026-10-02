export type VinylRecord = {
  id: string
  collection_owner?: string | null
  artist: string | null
  title: string | null
  year_pressed: number | null
  genre: string | null
  image_url: string | null
  source_url?: string | null
  record_label?: string | null
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
  notes?: string | null
  discogs_link?: string | null
  [key: string]: unknown
}