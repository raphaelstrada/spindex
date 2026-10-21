import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { BagTotals } from '@/components/storefront/BagDrawer'
import { RecordCover } from '@/components/storefront/RecordCard'
import { formatCad, interpolate } from '@/lib/catalog'
import { storeFocus, storeSecondaryButton, useBag, useBagSummary, useStorefrontLanguage } from '@/lib/storefront'
import { cn } from '@/lib/utils'

export default function BagPage() {
  const { language, t, app } = useStorefrontLanguage()
  const bag = useBag()
  const summary = useBagSummary()

  useEffect(() => {
    document.title = `${t.bagTitle} | ${app.title}`
  }, [t.bagTitle, app.title])

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
      <h1 className="mb-8 text-3xl font-bold tracking-tight md:text-4xl">{t.bagTitle}</h1>

      {summary.droppedSome && <p role="status" className="mb-6 border border-store-line bg-store-panel px-4 py-3 text-sm">{t.bagUnavailable}</p>}

      {summary.loading ? (
        <p role="status" className="text-store-muted">{t.loading}</p>
      ) : summary.error ? (
        <p role="alert" className="text-store-muted">{t.loadError}</p>
      ) : summary.records.length === 0 ? (
        <div className="flex flex-col items-start gap-6">
          <p className="text-store-muted">{t.bagEmpty}</p>
          <Link to="/" className={storeSecondaryButton}>{t.backToShop}</Link>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-store-line border-y border-store-line">
            {summary.records.map((record) => {
              const name = `${record.artist || t.unknownArtist}: ${record.title || t.untitled}`
              return (
                <li key={record.id} className="flex items-center gap-4 py-5">
                  <Link to={`/record/${record.id}`} className={cn('w-20 shrink-0 md:w-24', storeFocus)} tabIndex={-1} aria-hidden="true">
                    <RecordCover src={record.image_url} alt="" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/record/${record.id}`} className={cn('font-medium hover:underline', storeFocus)}>{name}</Link>
                    <p className="mt-1 text-sm">{formatCad(record.sale_price_cad, language)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => bag.remove(record.id)}
                    aria-label={interpolate(t.removeItem, { title: name })}
                    className={cn('flex h-10 w-10 items-center justify-center hover:bg-store-panel', storeFocus)}
                  >
                    <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-6">
            <BagTotals quote={summary.quote} onCheckout={summary.checkout} pending={summary.checkoutPending} failed={summary.checkoutError} />
          </div>
        </>
      )}
    </div>
  )
}
