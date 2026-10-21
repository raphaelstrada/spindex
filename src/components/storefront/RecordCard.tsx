import { Link } from 'react-router-dom'
import { Disc3 } from 'lucide-react'
import { formatCad, interpolate, type CatalogRecord } from '@/lib/catalog'
import { storeFocus, storeMonoLabel, useStorefrontLanguage } from '@/lib/storefront'
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
  const artist = record.artist || t.unknownArtist
  const title = record.title || t.untitled

  return (
    <Link to={`/record/${record.id}`} className={cn('group block', storeFocus)}>
      <RecordCover
        src={record.image_url}
        alt={interpolate(t.coverAlt, { title: `${artist}: ${title}` })}
        className="transition-opacity group-hover:opacity-90"
      />
      <div className="mt-3 space-y-1">
        <p className={cn(storeMonoLabel, 'truncate text-store-muted')}>{artist}</p>
        <p className="line-clamp-2 font-medium leading-snug group-hover:underline">{title}</p>
        <p className="text-sm">{formatCad(record.sale_price_cad, language)}</p>
      </div>
    </Link>
  )
}
