import { useCallback, useEffect, useState, type FocusEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel'
import { RecordCover } from '@/components/storefront/RecordCard'
import { formatCad, interpolate, type CatalogRecord } from '@/lib/catalog'
import { storeFocus, storeMonoLabel, storePrimaryButton, usePrefersReducedMotion, useStorefrontLanguage } from '@/lib/storefront'
import { cn } from '@/lib/utils'

const AUTOPLAY_MS = 6000

const arrowClass = cn(
  'absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center border border-store-ink bg-white text-store-ink transition-colors hover:bg-store-panel md:flex',
  storeFocus,
)

export function HeroCarousel({ records }: { records: CatalogRecord[] }) {
  const { language, t } = useStorefrontLanguage()
  const reducedMotion = usePrefersReducedMotion()
  const [api, setApi] = useState<CarouselApi>()
  const [selected, setSelected] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const multiple = records.length > 1

  useEffect(() => {
    if (!api) return
    const onSelect = () => setSelected(api.selectedScrollSnap())
    onSelect()
    api.on('select', onSelect)
    api.on('reInit', onSelect)
    return () => {
      api.off('select', onSelect)
      api.off('reInit', onSelect)
    }
  }, [api])

  const paused = hovered || focused || reducedMotion
  useEffect(() => {
    if (!api || !multiple || paused) return
    const timer = window.setInterval(() => api.scrollNext(), AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [api, multiple, paused])

  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
  }, [])

  return (
    <Carousel
      setApi={setApi}
      opts={{ loop: multiple, duration: reducedMotion ? 0 : 25, watchDrag: multiple }}
      aria-label={t.heroLabel}
      className="bg-store-panel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
    >
      <CarouselContent className="ml-0">
        {records.map((record, index) => {
          const artist = record.artist || t.unknownArtist
          const title = record.title || t.untitled
          const active = index === selected
          return (
            <CarouselItem
              key={record.id}
              className="pl-0"
              aria-label={interpolate(t.slideOf, { index: index + 1, total: records.length })}
              aria-hidden={!active}
              inert={!active}
            >
              <div className="mx-auto grid max-w-screen-2xl items-center gap-8 px-4 py-10 md:grid-cols-2 md:gap-16 md:px-20 md:py-16">
                <RecordCover
                  src={record.image_url}
                  alt={interpolate(t.coverAlt, { title: `${artist}: ${title}` })}
                  className="mx-auto w-full max-w-md shadow-polaroid"
                />
                <div className="space-y-5 text-center md:text-left">
                  <p className={cn(storeMonoLabel, 'text-store-muted')}>{artist}</p>
                  <h2 className="text-3xl font-bold leading-tight tracking-tight md:text-5xl">{title}</h2>
                  {record.hero_tagline && <p className="text-lg md:text-xl">{record.hero_tagline}</p>}
                  <p className="text-lg">{formatCad(record.sale_price_cad, language)}</p>
                  <Link to={`/record/${record.id}`} className={cn(storePrimaryButton, 'w-full md:w-auto')}>
                    {t.shopNow}
                  </Link>
                </div>
              </div>
            </CarouselItem>
          )
        })}
      </CarouselContent>

      {multiple && (
        <>
          <button type="button" className={cn(arrowClass, 'left-4')} onClick={() => api?.scrollPrev()} aria-label={t.previousSlide}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" className={cn(arrowClass, 'right-4')} onClick={() => api?.scrollNext()} aria-label={t.nextSlide}>
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="flex justify-center gap-1 pb-6">
            {records.map((record, index) => (
              <button
                key={record.id}
                type="button"
                onClick={() => api?.scrollTo(index)}
                aria-label={interpolate(t.goToSlide, { index: index + 1 })}
                aria-current={index === selected ? 'true' : undefined}
                className={cn('flex h-6 w-6 items-center justify-center rounded-full', storeFocus)}
              >
                <span
                  aria-hidden="true"
                  className={cn('block h-2 w-2 rounded-full border border-store-ink', index === selected ? 'bg-store-ink' : 'bg-transparent')}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </Carousel>
  )
}
