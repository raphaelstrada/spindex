import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { RecordCover } from '@/components/storefront/RecordCard'
import { formatCad, interpolate, recordDisplayName, type BagQuote } from '@/lib/catalog'
import { storeFocus, storeMonoLabel, storePrimaryButton, storeSecondaryButton, useBag, useBagSummary, useStorefrontLanguage } from '@/lib/storefront'
import { cn } from '@/lib/utils'

// Subtotal, shipping estimate and checkout button. Every amount comes from bag_quote.
export function BagTotals({ quote, onCheckout, pending, failed }: {
  quote: BagQuote | null
  onCheckout: () => void
  pending: boolean
  failed: boolean
}) {
  const { language, t } = useStorefrontLanguage()

  return (
    <div className="space-y-3">
      {quote ? (
        <dl className="space-y-2">
          <div className="flex items-center justify-between">
            <dt className={storeMonoLabel}>{t.subtotal}</dt>
            <dd className="text-lg">{formatCad(quote.subtotal_cad, language)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className={storeMonoLabel}>{t.shipping}</dt>
            <dd>{quote.shipping_cad === 0 ? t.freeShipping : formatCad(quote.shipping_cad, language)}</dd>
          </div>
        </dl>
      ) : (
        <p role="status" className="text-sm text-store-muted">{t.loading}</p>
      )}
      {quote?.free_shipping_remaining_cad != null && (
        <p className="text-sm">{interpolate(t.freeShippingHint, { amount: formatCad(quote.free_shipping_remaining_cad, language) })}</p>
      )}
      <p className="text-xs text-store-muted">{t.shippingNote}</p>
      <button type="button" disabled={!quote || pending} onClick={onCheckout} className={cn(storePrimaryButton, 'w-full')}>
        {pending ? t.checkoutPending : t.checkout}
      </button>
      {failed && <p role="alert" className="text-sm">{t.checkoutError}</p>}
    </div>
  )
}

function BagDrawerBody() {
  const { language, t } = useStorefrontLanguage()
  const bag = useBag()
  const summary = useBagSummary()

  return (
    <>
      {summary.droppedSome && <p role="status" className="mb-4 border border-store-line bg-store-panel px-4 py-3 text-sm">{t.bagUnavailable}</p>}

      {summary.loading ? (
        <p role="status" className="text-store-muted">{t.loading}</p>
      ) : summary.error ? (
        <p role="alert" className="text-store-muted">{t.loadError}</p>
      ) : summary.records.length === 0 ? (
        <p className="text-store-muted">{t.bagEmpty}</p>
      ) : (
        <>
          <ul className="-mx-1 flex-1 divide-y divide-store-line overflow-y-auto border-y border-store-line px-1">
            {summary.records.map((record) => {
              const name = recordDisplayName(record, t.unknownArtist, t.untitled)
              return (
                <li key={record.id} className="flex items-center gap-3 py-4">
                  <Link
                    to={`/record/${record.id}`}
                    onClick={() => bag.setDrawerOpen(false)}
                    className={cn('w-16 shrink-0', storeFocus)}
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    <RecordCover src={record.image_url} alt="" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/record/${record.id}`}
                      onClick={() => bag.setDrawerOpen(false)}
                      className={cn('line-clamp-2 text-sm font-medium hover:underline', storeFocus)}
                    >
                      {name}
                    </Link>
                    <p className="mt-1 text-sm">{formatCad(record.sale_price_cad, language)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => bag.remove(record.id)}
                    aria-label={interpolate(t.removeItem, { title: name })}
                    className={cn('flex h-10 w-10 shrink-0 items-center justify-center hover:bg-store-panel', storeFocus)}
                  >
                    <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-6 space-y-3">
            <BagTotals quote={summary.quote} onCheckout={summary.checkout} pending={summary.checkoutPending} failed={summary.checkoutError} />
            <Link to="/bag" onClick={() => bag.setDrawerOpen(false)} className={cn(storeSecondaryButton, 'w-full')}>{t.viewBag}</Link>
          </div>
        </>
      )}
    </>
  )
}

// Mini bag, opened from the header icon and after "Add to bag". The body mounts on every open,
// so availability and totals are always fetched fresh.
export function BagDrawer() {
  const { t } = useStorefrontLanguage()
  const bag = useBag()

  return (
    <DialogPrimitive.Root open={bag.drawerOpen} onOpenChange={bag.setDrawerOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white p-6 text-store-ink shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right motion-reduce:animate-none"
        >
          <div className="mb-6 flex items-center justify-between">
            <DialogPrimitive.Title className="text-2xl font-bold tracking-tight">{t.bagTitle}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label={t.closeBag} className={cn('flex h-10 w-10 items-center justify-center hover:bg-store-panel', storeFocus)}>
              <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <BagDrawerBody />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
