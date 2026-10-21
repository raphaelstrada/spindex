import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import { translations, type Language } from '@/lib/i18n'
import { cancelCheckout, fetchBagQuote, fetchCatalogByIds, startCheckout, type BagQuote, type CatalogRecord } from '@/lib/catalog'

export type StorefrontLanguageState = {
  language: Language
  setLanguage: (language: Language) => void
}

export const StorefrontLanguageContext = createContext<StorefrontLanguageState | null>(null)

export function useStorefrontLanguage() {
  const context = useContext(StorefrontLanguageContext)
  if (!context) throw new Error('useStorefrontLanguage must be used inside StorefrontLanguageProvider')
  const { language, setLanguage } = context
  return { language, setLanguage, t: translations[language].storefront, app: translations[language].app }
}

// The bag holds record ids only. Prices are always read from public_catalog.
export type BagState = {
  ids: string[]
  count: number
  add: (id: string) => void
  remove: (id: string) => void
  removeMany: (ids: string[]) => void
  clear: () => void
  has: (id: string) => boolean
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
}

export const BagContext = createContext<BagState | null>(null)

export function useBag() {
  const context = useContext(BagContext)
  if (!context) throw new Error('useBag must be used inside BagProvider')
  return context
}

// The Stripe session the buyer was last sent to. When they come back without paying (cancel link
// or the browser back button), it is released first so their own reserved records stay in the bag.
const PENDING_CHECKOUT_KEY = 'spindex-pending-checkout'

function readPendingCheckout() {
  try {
    return window.localStorage.getItem(PENDING_CHECKOUT_KEY)
  } catch {
    return null
  }
}

function writePendingCheckout(sessionId: string | null) {
  try {
    if (sessionId) window.localStorage.setItem(PENDING_CHECKOUT_KEY, sessionId)
    else window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
  } catch {
    // Storage unavailable: an abandoned reservation then expires on its own after 30 minutes.
  }
}

export function clearPendingCheckout() {
  writePendingCheckout(null)
}

type BagData = { key: string, records: CatalogRecord[], quote: BagQuote | null }

// Shared by the bag drawer and the bag page: loads the bag from public_catalog and bag_quote,
// drops ids that are no longer listed, and starts the checkout. Every amount comes from the server.
export function useBagSummary() {
  const bag = useBag()
  const { language } = useStorefrontLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingSessionId, setPendingSessionId] = useState(() => searchParams.get('cancelled') ?? readPendingCheckout())
  const [data, setData] = useState<BagData | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [droppedSome, setDroppedSome] = useState(false)
  const [checkoutState, setCheckoutState] = useState<'idle' | 'pending' | 'error'>('idle')
  const idsKey = bag.ids.join(',')

  useEffect(() => {
    if (!pendingSessionId) return
    let cancelled = false
    cancelCheckout(pendingSessionId)
      .catch((error: unknown) => console.error('Failed to release checkout', error))
      .finally(() => {
        writePendingCheckout(null)
        if (cancelled) return
        setPendingSessionId(null)
        setSearchParams((params) => {
          params.delete('cancelled')
          return params
        }, { replace: true })
      })
    return () => {
      cancelled = true
    }
  }, [pendingSessionId, setSearchParams])

  useEffect(() => {
    if (pendingSessionId || !idsKey) return
    let cancelled = false
    const ids = idsKey.split(',')
    Promise.all([fetchCatalogByIds(ids), fetchBagQuote(ids)])
      .then(([records, quote]) => {
        if (cancelled) return
        // Ids missing from public_catalog were sold, reserved or unlisted.
        const available = new Set(records.map((record) => record.id))
        const missing = ids.filter((id) => !available.has(id))
        if (missing.length > 0) {
          setDroppedSome(true)
          bag.removeMany(missing)
        }
        setData({
          key: idsKey,
          records: ids.map((id) => records.find((record) => record.id === id)).filter((record): record is CatalogRecord => Boolean(record)),
          quote,
        })
      })
      .catch((error: unknown) => {
        console.error('Failed to load bag', error)
        if (!cancelled) setErrorKey(idsKey)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, pendingSessionId])

  async function checkout() {
    setCheckoutState('pending')
    try {
      const result = await startCheckout(bag.ids, language)
      if ('url' in result) {
        writePendingCheckout(result.sessionId)
        // The back button from Stripe then lands on the bag, which releases the reservation first.
        window.history.replaceState(null, '', `${import.meta.env.BASE_URL}bag`)
        window.location.assign(result.url)
        return
      }
      setDroppedSome(true)
      bag.removeMany(result.unavailableIds)
      setCheckoutState('idle')
    } catch (error) {
      console.error('Checkout failed', error)
      setCheckoutState('error')
    }
  }

  // While a removal is refetched, keep showing the remaining records; the totals wait for the fresh quote.
  const fresh = Boolean(idsKey) && data?.key === idsKey
  return {
    records: idsKey && data ? data.records.filter((record) => bag.ids.includes(record.id)) : [],
    quote: fresh ? data?.quote ?? null : null,
    loading: Boolean(pendingSessionId) || (Boolean(idsKey) && !data && errorKey !== idsKey),
    error: Boolean(idsKey) && !fresh && errorKey === idsKey,
    droppedSome,
    checkout,
    checkoutPending: checkoutState === 'pending',
    checkoutError: checkoutState === 'error',
  }
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )
}

// Polaroid-style button and label classes shared by storefront components.
export const storeFocus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-ink focus-visible:ring-offset-2'
export const storePrimaryButton = `inline-flex h-14 items-center justify-center bg-store-ink px-8 font-mono-ui text-sm uppercase tracking-[0.12em] text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-store-muted ${storeFocus}`
export const storeSecondaryButton = `inline-flex h-14 items-center justify-center border border-store-ink bg-white px-8 font-mono-ui text-sm uppercase tracking-[0.12em] text-store-ink transition-colors hover:bg-store-panel ${storeFocus}`
export const storeMonoLabel = 'font-mono-ui text-xs uppercase tracking-[0.12em]'

// Catalog grid filters.
export type CatalogFilterValues = {
  artist: string
  genre: string
  year: string
  condition: string
  owner: string
}

export const ALL = '__all__'

export const EMPTY_FILTERS: CatalogFilterValues = { artist: '', genre: ALL, year: ALL, condition: ALL, owner: ALL }

export type CatalogFilterOptions = {
  genres: string[]
  years: string[]
  conditions: string[]
  owners: string[]
}
