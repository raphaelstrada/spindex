import { Link } from 'react-router-dom'
import { Check, Disc3, ShoppingCartPlus } from 'lucide-react'
import { formatCad, interpolate, type CatalogRecord } from '@/lib/catalog'
import { storeFocus, storeMonoLabel, useBag, useStorefrontLanguage, useStore } from '@/lib/storefront'
import { cn } from '@/lib/utils'

export function RecordCover({ src, alt, className }: { src: string | null, alt: string, className?: string }) {
  const { t } = useStorefrontLanguage()
  return (
    <div className={cn('flex aspect-square items-center justify-center overflow-hidden bg-store-panel', className)}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <Disc3 className="h-1/3 w-1/3 text-store-muted" strokeWidth={1} aria-label={t.noImage} role="img" />
      )}
    </div>
  )
}

export function RecordCard({ record }: { record: CatalogRecord }) {
  const { language, t } = useStorefrontLanguage()
  const { path } = useStore()
  const bag = useBag()
  const artist = record.artist || t.unknownArtist
  const title = record.title || t.untitled
  const name = `${artist}: ${title}`
  const inBag = bag.has(record.id)

  return (
    <div className="relative">
      <Link to={path(`/record/${record.id}`)} className={cn('group block', storeFocus)}>
        <RecordCover
          src={record.image_url}
          alt={interpolate(t.coverAlt, { title: name })}
          className="transition-opacity group-hover:opacity-90"
        />
        <div className="mt-3 space-y-1 pr-10">
          <p className={cn(storeMonoLabel, 'truncate text-store-muted')}>{artist}</p>
          <p className="line-clamp-2 font-medium leading-snug group-hover:underline">{title}</p>
          <p className="text-sm">{formatCad(record.sale_price_cad, language)}</p>
        </div>
      </Link>
      {/* Outside the link, a button can't be nested in it. Pinned over the text's right padding. */}
      <button
        type="button"
        className={cn(storeFocus, 'absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center text-store-ink transition-colors hover:bg-store-panel disabled:cursor-default disabled:text-store-muted disabled:hover:bg-transparent')}
        disabled={inBag}
        title={inBag ? t.inYourBag : t.addToBag}
        aria-label={inBag ? t.inYourBag : interpolate(t.addItem, { title: name })}
        onClick={() => {
          bag.add(record.id)
          bag.setDrawerOpen(true)
        }}
      >
        {inBag
          ? <Check className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          : <ShoppingCartPlus className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />}
      </button>
    </div>
  )
}
