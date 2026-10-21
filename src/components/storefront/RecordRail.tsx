import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel'
import { RecordCard } from '@/components/storefront/RecordCard'
import type { CatalogRecord } from '@/lib/catalog'
import { storeFocus, useStorefrontLanguage } from '@/lib/storefront'
import { cn } from '@/lib/utils'

const arrowClass = cn('flex h-10 w-10 items-center justify-center border border-store-ink bg-white transition-colors hover:bg-store-panel disabled:opacity-30', storeFocus)

export function RecordRail({ title, records }: { title: string, records: CatalogRecord[] }) {
  const { t } = useStorefrontLanguage()
  const [api, setApi] = useState<CarouselApi>()
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  useEffect(() => {
    if (!api) return
    const update = () => {
      setCanPrev(api.canScrollPrev())
      setCanNext(api.canScrollNext())
    }
    update()
    api.on('select', update)
    api.on('reInit', update)
    return () => {
      api.off('select', update)
      api.off('reInit', update)
    }
  }, [api])

  if (records.length === 0) return null

  return (
    <section className="mt-20" aria-label={title}>
      <div className="mb-6 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
        {(canPrev || canNext) && (
          <div className="flex gap-2">
            <button type="button" className={arrowClass} onClick={() => api?.scrollPrev()} disabled={!canPrev} aria-label={t.previousSlide}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" className={arrowClass} onClick={() => api?.scrollNext()} disabled={!canNext} aria-label={t.nextSlide}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <Carousel setApi={setApi} opts={{ align: 'start', slidesToScroll: 'auto' }} aria-label={title}>
        <CarouselContent>
          {records.map((record) => (
            <CarouselItem key={record.id} className="basis-1/2 md:basis-1/3 lg:basis-1/4">
              <RecordCard record={record} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </section>
  )
}
