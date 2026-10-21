import { supabase } from '@/lib/supabase'
import type { Language } from '@/lib/i18n'

// Mirrors the public_catalog view exactly. The storefront must never read any other column or table.
export type CatalogRecord = {
  id: string
  collection_owner: string | null
  artist: string | null
  title: string | null
  year_pressed: number | null
  genre: string | null
  sub_genre: string | null
  record_label: string | null
  record_type: string | null
  record_size: string | null
  country_pressed: string | null
  media_condition: string | null
  sleeve_condition: string | null
  is_original: boolean | null
  is_special_edition: boolean | null
  special_edition_reason: string | null
  image_url: string | null
  original_image_url: string | null
  discogs_link: string | null
  is_hero: boolean | null
  hero_tagline: string | null
  sale_price_cad: number
}

const CATALOG_COLUMNS = 'id, collection_owner, artist, title, year_pressed, genre, sub_genre, record_label, record_type, record_size, country_pressed, media_condition, sleeve_condition, is_original, is_special_edition, special_edition_reason, image_url, original_image_url, discogs_link, is_hero, hero_tagline, sale_price_cad'

const RELATED_LIMIT = 12
// PostgREST caps each response (1000 rows by default), so the full catalog is read in pages.
const PAGE_SIZE = 1000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function catalogQuery() {
  return supabase.from('public_catalog').select(CATALOG_COLUMNS)
}

export async function fetchCatalog(): Promise<CatalogRecord[]> {
  const records: CatalogRecord[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await catalogQuery()
      .order('artist', { ascending: true })
      .order('title', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as CatalogRecord[]
    records.push(...page)
    if (page.length < PAGE_SIZE) return records
  }
}

export async function fetchCatalogRecord(id: string): Promise<CatalogRecord | null> {
  if (!UUID_PATTERN.test(id)) return null
  const { data, error } = await catalogQuery().eq('id', id).maybeSingle()
  if (error) throw error
  return data as CatalogRecord | null
}

export async function fetchCatalogByIds(ids: string[]): Promise<CatalogRecord[]> {
  const validIds = ids.filter((id) => UUID_PATTERN.test(id))
  if (validIds.length === 0) return []
  const { data, error } = await catalogQuery().in('id', validIds)
  if (error) throw error
  return (data ?? []) as CatalogRecord[]
}

// Computed by the bag_quote SQL function from public_catalog and shipping_settings. Display only:
// create-checkout recomputes everything from the record ids.
export type BagQuote = {
  available_ids: string[]
  subtotal_cad: number
  shipping_cad: number
  free_shipping_remaining_cad: number | null
}

export async function fetchBagQuote(ids: string[]): Promise<BagQuote> {
  const { data, error } = await supabase.rpc('bag_quote', { p_ids: ids.filter((id) => UUID_PATTERN.test(id)) })
  if (error) throw error
  return data as BagQuote
}

export type CheckoutResult =
  | { url: string, sessionId: string }
  | { unavailableIds: string[] }

// Sends record ids only. The server reserves the records and returns the Stripe Checkout URL.
export async function startCheckout(ids: string[], language: Language): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke<{ url: string, session_id: string }>('create-checkout', {
    body: { record_ids: ids.filter((id) => UUID_PATTERN.test(id)), language },
  })
  if (error) {
    const response = (error as { context?: unknown }).context
    if (response instanceof Response && response.status === 409) {
      const body = await response.json() as { unavailable_ids?: string[] }
      return { unavailableIds: body.unavailable_ids ?? [] }
    }
    throw error
  }
  if (!data?.url) throw new Error('Checkout did not return a URL.')
  return { url: data.url, sessionId: data.session_id }
}

// Releases the reservation of a checkout the buyer left. The server only releases sessions Stripe reports as expired.
export async function cancelCheckout(sessionId: string) {
  const { error } = await supabase.functions.invoke('create-checkout', { body: { cancel_session_id: sessionId } })
  if (error) throw error
}

export async function fetchRelated(record: CatalogRecord): Promise<{ sameArtist: CatalogRecord[], sameGenre: CatalogRecord[] }> {
  const [artistResult, genreResult] = await Promise.all([
    record.artist
      ? catalogQuery().eq('artist', record.artist).neq('id', record.id).limit(RELATED_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    record.genre
      ? catalogQuery().eq('genre', record.genre).neq('id', record.id).limit(RELATED_LIMIT * 2)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (artistResult.error) throw artistResult.error
  if (genreResult.error) throw genreResult.error

  const sameArtist = (artistResult.data ?? []) as CatalogRecord[]
  const sameGenre = ((genreResult.data ?? []) as CatalogRecord[])
    .filter((item) => item.artist !== record.artist)
    .slice(0, RELATED_LIMIT)
  return { sameArtist, sameGenre }
}

// Formats the server-computed sale_price_cad. Never derives a price in the browser.
export function formatCad(value: number, language: Language) {
  const formatted = new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
  return `${formatted} CAD`
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function recordDisplayName(record: Pick<CatalogRecord, 'artist' | 'title'>, fallbackArtist: string, fallbackTitle: string) {
  return `${record.artist || fallbackArtist}: ${record.title || fallbackTitle}`
}

export function interpolate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}
