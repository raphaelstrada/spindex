import { useEffect, useState } from 'react'
import { usePrefersReducedMotion, useStorefrontLanguage } from '@/lib/storefront'

const ROTATE_MS = 5000

export function AnnouncementBar() {
  const { t } = useStorefrontLanguage()
  const reducedMotion = usePrefersReducedMotion()
  const messages = t.announcements
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (reducedMotion || messages.length < 2) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % messages.length), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [reducedMotion, messages.length])

  return (
    <div className="bg-store-ink text-[13px] text-white">
      {/* Desktop: every message in a row. */}
      <ul className="mx-auto hidden h-9 max-w-screen-2xl items-center justify-center gap-14 px-4 md:flex">
        {messages.map((message) => <li key={message}>{message}</li>)}
      </ul>
      {/* Mobile: one message at a time. */}
      <p className="flex h-9 items-center justify-center px-4 text-center md:hidden" aria-live="off">
        {messages[index % messages.length]}
      </p>
    </div>
  )
}
