import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Language } from '@/lib/i18n'
import { StorefrontLanguageContext } from '@/lib/storefront'

const LANGUAGE_KEY = 'spindex-language'

function readLanguage(): Language {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === 'pt' ? 'pt' : 'en'
  } catch {
    return 'en'
  }
}

export function StorefrontLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(readLanguage)

  useEffect(() => {
    document.documentElement.lang = language
    try {
      window.localStorage.setItem(LANGUAGE_KEY, language)
    } catch {
      // Storage unavailable: keep the in-memory choice.
    }
  }, [language])

  const value = useMemo(() => ({ language, setLanguage }), [language])
  return <StorefrontLanguageContext.Provider value={value}>{children}</StorefrontLanguageContext.Provider>
}
