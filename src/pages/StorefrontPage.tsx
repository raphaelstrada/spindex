import { useEffect } from 'react'
import { translations, type Language } from '@/lib/i18n'
import { Logo } from '@/components/Logo'

export default function StorefrontPage() {
  const language: Language = window.localStorage.getItem('spindex-language') === 'pt' ? 'pt' : 'en'
  const t = translations[language]

  useEffect(() => {
    document.documentElement.lang = language
    document.title = t.app.title
  }, [language, t.app.title])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1>
        <Logo />
      </h1>
      <p className="text-lg text-muted-foreground">{t.storefront.comingSoon}</p>
    </div>
  )
}
