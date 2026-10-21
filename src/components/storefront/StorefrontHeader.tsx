import { Link } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Language } from '@/lib/i18n'
import { interpolate } from '@/lib/catalog'
import { useBag, useStorefrontLanguage } from '@/lib/storefront'

export function StorefrontHeader() {
  const { language, setLanguage, t, app } = useStorefrontLanguage()
  const { count, setDrawerOpen } = useBag()

  return (
    <header className="sticky top-0 z-40 border-b border-store-line bg-white">
      <div className="mx-auto grid h-16 max-w-screen-2xl grid-cols-[1fr_auto_1fr] items-center px-4 md:px-10">
        <div className="justify-self-start">
          <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
            <SelectTrigger
              aria-label={app.changeLanguage}
              className="h-9 w-auto gap-2 rounded-none border-0 bg-transparent px-2 font-mono-ui text-xs uppercase tracking-wider shadow-none focus:ring-store-ink"
            >
              <SelectValue>{language.toUpperCase()}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">{app.english}</SelectItem>
              <SelectItem value="pt">{app.portuguese}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Link to="/" aria-label={t.home} className="justify-self-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-ink focus-visible:ring-offset-2">
          <Logo className="text-store-ink" />
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          aria-label={interpolate(t.bagWithCount, { count })}
          className="flex items-center gap-1.5 justify-self-end rounded-sm p-1 font-mono-ui text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-ink focus-visible:ring-offset-2"
        >
          <ShoppingBag className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          <span aria-hidden="true">[{count}]</span>
        </button>
      </div>
    </header>
  )
}
