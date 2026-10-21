import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BagContext } from '@/lib/storefront'

const BAG_KEY = 'spindex-bag'

function readBag(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(BAG_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function BagProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>(readBag)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(BAG_KEY, JSON.stringify(ids))
    } catch {
      // Storage unavailable: the bag lives for this session only.
    }
  }, [ids])

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
      if (event.key === BAG_KEY) setIds(readBag())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

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
