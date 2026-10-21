import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { clearPendingCheckout, storeSecondaryButton, useBag, useStorefrontLanguage } from '@/lib/storefront'

// Stripe redirects here after payment. The order itself is recorded by the stripe-webhook function,
// so this page only empties the bag and shows no order data.
export default function OrderSuccessPage() {
  const { t, app } = useStorefrontLanguage()
  const { clear } = useBag()

  useEffect(() => {
    clearPendingCheckout()
    clear()
  }, [clear])

  useEffect(() => {
    document.title = `${t.orderSuccessTitle} | ${app.title}`
  }, [t.orderSuccessTitle, app.title])

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 px-4 py-16 md:py-24">
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{t.orderSuccessTitle}</h1>
      <p className="text-lg text-store-muted">{t.orderSuccessBody}</p>
      <Link to="/" className={storeSecondaryButton}>{t.backToShop}</Link>
    </div>
  )
}
