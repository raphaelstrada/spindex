import { useEffect, useMemo } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { AnnouncementBar } from '@/components/storefront/AnnouncementBar'
import { BagProvider } from '@/components/storefront/BagContext'
import { BagDrawer } from '@/components/storefront/BagDrawer'
import { StorefrontFooter } from '@/components/storefront/StorefrontFooter'
import { StorefrontHeader } from '@/components/storefront/StorefrontHeader'
import { StorefrontLanguageProvider } from '@/components/storefront/StorefrontLanguage'
import { FRONT_PAGE_OWNER, ownerFromSlug } from '@/lib/collection'
import { useContentProtection } from '@/lib/contentProtection'
import { StoreContext } from '@/lib/storefront'

export default function StorefrontLayout() {
  // Everything under /{owner} belongs to that owner; everything else is the front page store.
  const slug = useParams().owner
  const owner = slug === undefined ? FRONT_PAGE_OWNER : ownerFromSlug(slug)
  const store = useMemo(() => {
    if (!owner) return null
    const base = slug === undefined ? '' : `/${owner.toLowerCase()}`
    return { owner, path: (to: string) => (to === '/' ? base || '/' : `${base}${to}`) }
  }, [owner, slug])

  // The storefront is always light, whatever theme the admin picked.
  useEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.remove('dark')
    return () => {
      if (wasDark) root.classList.add('dark')
    }
  }, [])

  useContentProtection()

  if (!store) return <Navigate to="/" replace />

  return (
    <StoreContext.Provider value={store}>
    <StorefrontLanguageProvider>
      <BagProvider key={store.owner}>
        <div className="flex min-h-screen flex-col bg-white text-store-ink">
          <AnnouncementBar />
          <StorefrontHeader />
          <main className="flex-1">
            <Outlet />
          </main>
          <StorefrontFooter />
          <BagDrawer />
        </div>
      </BagProvider>
    </StorefrontLanguageProvider>
    </StoreContext.Provider>
  )
}
