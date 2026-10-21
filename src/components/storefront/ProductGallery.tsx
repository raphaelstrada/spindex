import { useState } from 'react'
import { RecordCover } from '@/components/storefront/RecordCard'
import { interpolate, type CatalogRecord } from '@/lib/catalog'
import { storeFocus, useStorefrontLanguage } from '@/lib/storefront'
import { cn } from '@/lib/utils'

export function ProductGallery({ record, name }: { record: CatalogRecord, name: string }) {
  const { t } = useStorefrontLanguage()
  const images = [
    { src: record.image_url, alt: interpolate(t.coverAlt, { title: name }) },
    ...(record.original_image_url ? [{ src: record.original_image_url, alt: interpolate(t.photoAlt, { title: name }) }] : []),
  ]
  const [active, setActive] = useState(0)
  const current = images[Math.min(active, images.length - 1)]

  return (
    <div className="bg-store-panel px-6 py-10 md:px-16 md:py-16">
      <RecordCover src={current.src} alt={current.alt} className="mx-auto w-full max-w-xl shadow-polaroid" />
      {images.length > 1 && (
        <div className="mt-8 flex justify-center gap-3">
          {images.map((image, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setActive(index)}
              aria-pressed={index === active}
              aria-label={interpolate(t.showImage, { index: index + 1 })}
              className={cn('w-20 border bg-white p-1', index === active ? 'border-store-ink' : 'border-transparent', storeFocus)}
            >
              <RecordCover src={image.src} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
