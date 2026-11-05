import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FRONT_PAGE_OWNER } from '@/lib/collection'
import { BagContext, useStore } from '@/lib/storefront'

const BAG_KEY = 'spindex-bag'

function readBag(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function BagProvider({ children }: { children: ReactNode }) {
  const { owner } = useStore()
  // One bag per store, so a store never shows another owner's records.
  const bagKey = owner === FRONT_PAGE_OWNER ? BAG_KEY : `${BAG_KEY}-${owner.toLowerCase()}`
  const [ids, setIds] = useState<string[]>(() => readBag(bagKey))
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(bagKey, JSON.stringify(ids))
    } catch {
      // Storage unavailable: the bag lives for this session only.
    }
  }, [bagKey, ids])

  // Coming back from Stripe with the back button can restore the page from the bfcache, with a stale
  // "redirecting" state and the reservation still held. Reload so the bag releases it.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === bagKey) setIds(readBag(bagKey))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [bagKey])

  // Every record is one of a kind, so an id is never added twice.
  const add = useCallback((id: string) => setIds((current) => (current.includes(id) ? current : [...current, id])), [])
  const remove = useCallback((id: string) => setIds((current) => current.filter((item) => item !== id)), [])
  const removeMany = useCallback((toRemove: string[]) => setIds((current) => current.filter((item) => !toRemove.includes(item))), [])
  const clear = useCallback(() => setIds([]), [])
  const has = useCallback((id: string) => ids.includes(id), [ids])

  const value = useMemo(
    () => ({ ids, count: ids.length, add, remove, removeMany, clear, has, drawerOpen, setDrawerOpen }),
    [ids, add, remove, removeMany, clear, has, drawerOpen],
  )
  return <BagContext.Provider value={value}>{children}</BagContext.Provider>
}
