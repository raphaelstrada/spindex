import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { interpolate } from '@/lib/catalog'
import { useStorefrontLanguage } from '@/lib/storefront'

const linkClass = 'rounded-sm text-sm text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'

function PaymentIcon({ label, children }: { label: string, children: ReactNode }) {
  return (
    <li>
      <svg viewBox="0 0 38 24" width="38" height="24" role="img" aria-label={label} className="rounded-[3px]">
        <rect width="38" height="24" rx="3" fill="#fff" />
        {children}
      </svg>
    </li>
  )
}

export function StorefrontFooter() {
  const { t } = useStorefrontLanguage()

  return (
    <footer className="mt-24 bg-store-ink text-white">
      <div className="mx-auto grid max-w-screen-2xl gap-10 px-4 py-14 md:grid-cols-4 md:px-10">
        <div>
          <Logo className="text-white" />
        </div>
        <nav aria-labelledby="footer-shop">
          <h2 id="footer-shop" className="mb-4 font-mono-ui text-xs uppercase tracking-widest">{t.footerShop}</h2>
          <ul className="space-y-2">
            <li><Link to="/" className={linkClass}>{t.footerAllRecords}</Link></li>
            <li><Link to="/bag" className={linkClass}>{t.footerBag}</Link></li>
          </ul>
        </nav>
        <div>
          <h2 className="mb-4 font-mono-ui text-xs uppercase tracking-widest">{t.footerHelp}</h2>
          <ul className="space-y-2 text-sm text-white/75">
            <li>{t.footerShipping}: {t.shippingBody.split('.')[0]}.</li>
            <li>{t.footerGrading}: {t.gradingIntro}</li>
          </ul>
        </div>
        <div>
          <h2 className="mb-4 font-mono-ui text-xs uppercase tracking-widest">{t.footerAbout}</h2>
          <p className="text-sm text-white/75">{t.footerAboutUs}</p>
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-screen-2xl flex-col-reverse items-start justify-between gap-4 px-4 py-6 md:flex-row md:items-center md:px-10">
          <p className="text-xs text-white/60">{interpolate(t.copyright, { year: new Date().getFullYear() })}</p>
          <ul className="flex gap-2" aria-label={t.paymentMethods}>
            <PaymentIcon label="Visa">
              <text x="19" y="16" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="10" fontStyle="italic" fontWeight="700" fill="#1a1f71">VISA</text>
            </PaymentIcon>
            <PaymentIcon label="Mastercard">
              <circle cx="15" cy="12" r="7" fill="#eb001b" />
              <circle cx="23" cy="12" r="7" fill="#f79e1b" fillOpacity="0.9" />
            </PaymentIcon>
            <PaymentIcon label="American Express">
              <rect x="2" y="2" width="34" height="20" rx="2" fill="#2e77bc" />
              <text x="19" y="15.5" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="8" fontWeight="700" fill="#fff">AMEX</text>
            </PaymentIcon>
            <PaymentIcon label="Apple Pay">
              <text x="19" y="16" textAnchor="middle" fontFamily="-apple-system, Helvetica, Arial, sans-serif" fontSize="9" fontWeight="600" fill="#000">Pay</text>
            </PaymentIcon>
          </ul>
        </div>
      </div>
    </footer>
  )
}
