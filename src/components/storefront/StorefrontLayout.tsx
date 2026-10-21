import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { AnnouncementBar } from '@/components/storefront/AnnouncementBar'
import { BagProvider } from '@/components/storefront/BagContext'
import { BagDrawer } from '@/components/storefront/BagDrawer'
import { StorefrontFooter } from '@/components/storefront/StorefrontFooter'
import { StorefrontHeader } from '@/components/storefront/StorefrontHeader'
import { StorefrontLanguageProvider } from '@/components/storefront/StorefrontLanguage'

export default function StorefrontLayout() {
  // The storefront is always light, whatever theme the admin picked.
  useEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.remove('dark')
    return () => {
      if (wasDark) root.classList.add('dark')
    }
  }, [])

  return (
    <StorefrontLanguageProvider>
      <BagProvider>
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
  )
}
