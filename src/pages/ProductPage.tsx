import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ExternalLink, Minus, Plus } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { ProductGallery } from '@/components/storefront/ProductGallery'
import { RecordRail } from '@/components/storefront/RecordRail'
import { fetchCatalogRecord, fetchRelated, formatCad, type CatalogRecord } from '@/lib/catalog'
import { storeFocus, storeMonoLabel, storePrimaryButton, storeSecondaryButton, useBag, useStorefrontLanguage } from '@/lib/storefront'
import { cn } from '@/lib/utils'

type LoadState =
  | { id: string, status: 'error' }
  | { id: string, status: 'ready', record: CatalogRecord | null }

type Related = { id: string, sameArtist: CatalogRecord[], sameGenre: CatalogRecord[] }

function joinParts(parts: (string | number | null | undefined)[], separator = ' · ') {
  return parts.filter((part) => part !== null && part !== undefined && part !== '').join(separator)
}

const accordionIcon = (
  <span className="ml-4 shrink-0" aria-hidden="true">
    <Plus className="h-4 w-4 group-data-[state=open]:hidden" strokeWidth={1.5} />
    <Minus className="hidden h-4 w-4 group-data-[state=open]:block" strokeWidth={1.5} />
  </span>
)

function InfoAccordionItem({ value, title, children }: { value: string, title: string, children: ReactNode }) {
  return (
    <AccordionItem value={value} className="border-store-line">
      <AccordionTrigger icon={accordionIcon} className={cn('group py-5 hover:no-underline', storeMonoLabel, 'text-sm', storeFocus)}>
        {title}
      </AccordionTrigger>
      <AccordionContent className="text-[15px] leading-relaxed text-store-ink">{children}</AccordionContent>
    </AccordionItem>
  )
}

export default function ProductPage() {
  const { id = '' } = useParams()
  const { language, t, app } = useStorefrontLanguage()
  const bag = useBag()
  // Both are tagged with the id they belong to, so a new id reads as loading without resetting state in the effect.
  const [loaded, setLoaded] = useState<LoadState | null>(null)
  const [relatedState, setRelated] = useState<Related | null>(null)
  const state = loaded?.id === id ? loaded : { id, status: 'loading' as const }
  const related = relatedState?.id === id ? relatedState : { sameArtist: [], sameGenre: [] }

  useEffect(() => {
    window.scrollTo(0, 0)
    let cancelled = false
    fetchCatalogRecord(id)
      .then((record) => {
        if (cancelled) return
        setLoaded({ id, status: 'ready', record })
        if (record) {
          fetchRelated(record)
            .then((result) => {
              if (!cancelled) setRelated({ id, ...result })
            })
            .catch((fetchError: unknown) => console.error('Failed to load related records', fetchError))
        }
      })
      .catch((fetchError: unknown) => {
        console.error('Failed to load record', fetchError)
        if (!cancelled) setLoaded({ id, status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const record = state.status === 'ready' ? state.record : null
  const artist = record?.artist || t.unknownArtist
  const title = record?.title || t.untitled
  const name = `${artist}: ${title}`

  useEffect(() => {
    document.title = record ? `${name} | ${app.title}` : app.title
  }, [record, name, app.title])

  if (state.status === 'loading') {
    return (
      <div className="mx-auto grid max-w-screen-2xl lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" aria-busy="true">
        <span className="sr-only" role="status">{t.loading}</span>
        <div className="aspect-square animate-pulse bg-store-panel lg:aspect-auto lg:min-h-[640px]" />
        <div className="space-y-4 px-4 py-10 md:px-16">
          <div className="h-3 w-1/2 animate-pulse bg-store-panel" />
          <div className="h-10 w-3/4 animate-pulse bg-store-panel" />
          <div className="h-5 w-1/4 animate-pulse bg-store-panel" />
        </div>
      </div>
    )
  }

  if (!record) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-24 text-center" role={state.status === 'error' ? 'alert' : 'status'}>
        <h1 className="text-3xl font-bold tracking-tight">{state.status === 'error' ? t.loadError : t.notFoundTitle}</h1>
        {state.status !== 'error' && <p className="text-store-muted">{t.notFoundBody}</p>}
        <Link to="/" className={storeSecondaryButton}>{t.backToShop}</Link>
      </div>
    )
  }

  const inBag = bag.has(record.id)
  const format = joinParts([record.record_type, record.record_size], ', ')
  const genreStyle = joinParts([record.genre, record.sub_genre], ' / ')
  const bullets = [
    record.record_label && `${t.label}: ${record.record_label}`,
    joinParts([record.year_pressed, record.country_pressed]) && `${t.pressed}: ${joinParts([record.year_pressed, record.country_pressed], ', ')}`,
    genreStyle && `${t.genreStyle}: ${genreStyle}`,
    format && `${t.format}: ${format}`,
  ].filter(Boolean) as string[]

  const details: [string, string][] = ([
    [t.label, record.record_label],
    [t.year, record.year_pressed ? String(record.year_pressed) : null],
    [t.country, record.country_pressed],
    [t.genre, record.genre],
    [t.style, record.sub_genre],
    [t.format, format],
    [t.originalPressing, record.is_original === null ? null : (record.is_original ? t.yes : t.no)],
    [t.specialEdition, record.is_special_edition ? (record.special_edition_reason || t.yes) : null],
  ] as [string, string | null][]).filter((entry): entry is [string, string] => Boolean(entry[1]))

  return (
    <div className="mx-auto max-w-screen-2xl">
      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ProductGallery key={record.id} record={record} name={name} />

        <div className="px-4 py-8 md:px-12 lg:py-14 xl:px-16">
          <nav aria-label={t.breadcrumb} className={cn(storeMonoLabel, 'mb-8')}>
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <li><Link to="/" className={cn('hover:underline', storeFocus)}>{t.shop}</Link></li>
              {record.genre && (
                <>
                  <li aria-hidden="true">/</li>
                  <li>{record.genre}</li>
                </>
              )}
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-store-muted">{artist}</li>
            </ol>
          </nav>

          <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">{name}</h1>
          <p className="mt-3 text-lg">{formatCad(record.sale_price_cad, language)}</p>

          {bullets.length > 0 && (
            <ul className="mt-8 space-y-2.5">
              {bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2">
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          )}

          {(record.media_condition || record.sleeve_condition) && (
            <div className="mt-6 flex flex-wrap gap-2">
              {record.media_condition && (
                <Badge variant="outline" className="rounded-none border-store-ink px-3 py-1 font-mono-ui font-normal uppercase tracking-wider text-store-ink">
                  {t.mediaCondition}: {record.media_condition}
                </Badge>
              )}
              {record.sleeve_condition && (
                <Badge variant="outline" className="rounded-none border-store-ink px-3 py-1 font-mono-ui font-normal uppercase tracking-wider text-store-ink">
                  {t.sleeveCondition}: {record.sleeve_condition}
                </Badge>
              )}
            </div>
          )}

          <div className="mt-10 space-y-3">
            <button
              type="button"
              className={cn(storePrimaryButton, 'w-full')}
              disabled={inBag}
              onClick={() => {
                bag.add(record.id)
                bag.setDrawerOpen(true)
              }}
            >
              {inBag ? t.inYourBag : t.addToBag}
            </button>
            <p className="text-sm text-store-muted" aria-live="polite">
              {inBag ? <Link to="/bag" className={cn('text-store-ink underline underline-offset-4', storeFocus)}>{t.viewBag}</Link> : t.oneOfAKind}
            </p>
          </div>

          <Accordion type="multiple" className="mt-10 border-t border-store-line" aria-label={t.productInfo}>
            {details.length > 0 && (
              <InfoAccordionItem value="details" title={t.details}>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                  {details.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-store-muted">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </InfoAccordionItem>
            )}
            <InfoAccordionItem value="condition" title={t.conditionAndGrading}>
              {(record.media_condition || record.sleeve_condition) && (
                <p className="mb-3">
                  {joinParts([
                    record.media_condition && `${t.mediaCondition}: ${record.media_condition}`,
                    record.sleeve_condition && `${t.sleeveCondition}: ${record.sleeve_condition}`,
                  ])}
                </p>
              )}
              <p className="mb-2">{t.gradingIntro}</p>
              <p className="text-store-muted">{t.gradingScale}</p>
            </InfoAccordionItem>
            <InfoAccordionItem value="shipping" title={t.shippingAndReturns}>
              <p>{t.shippingBody}</p>
            </InfoAccordionItem>
            {record.discogs_link && (
              <InfoAccordionItem value="discogs" title={t.viewOnDiscogs}>
                <a
                  href={record.discogs_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('inline-flex items-center gap-1.5 underline underline-offset-4', storeFocus)}
                >
                  {t.openDiscogs}
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </InfoAccordionItem>
            )}
          </Accordion>
        </div>
      </div>

      <div className="px-4 md:px-10">
        <RecordRail title={t.moreFromArtist} records={related.sameArtist} />
        <RecordRail title={t.youMightAlsoLike} records={related.sameGenre} />
      </div>
    </div>
  )
}
