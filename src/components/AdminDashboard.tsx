import { useMemo, useState } from 'react'
import { ChevronDown, LayoutDashboard } from 'lucide-react'
import type { AdminView } from '@/components/DataTable'
import { translations, type Language } from '@/lib/i18n'
import { isOnFacebookMarketplace, storeExclusion, type VinylRecord } from '@/lib/record'

const STORAGE_KEY = 'spindex-dashboard-open'
const TOP_COUNT = 8

type Ranked = { label: string; count: number; hint?: string }

function readOpenState() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function formatMoney(value: number, currency: string, language: Language) {
  const locale = language === 'pt' ? 'pt-BR' : 'en-US'
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  } catch {
    return `${currency} ${Math.round(value)}`
  }
}

/** Sums a price per currency, so mixed currencies are never added together. */
function sumByCurrency(records: VinylRecord[], price: (record: VinylRecord) => number | null | undefined, currency: (record: VinylRecord) => string | null | undefined) {
  const totals = new Map<string, number>()
  for (const record of records) {
    const value = price(record)
    if (value == null) continue
    const code = currency(record) || 'USD'
    totals.set(code, (totals.get(code) ?? 0) + Number(value))
  }
  return totals
}

function formatTotals(totals: Map<string, number>, language: Language) {
  if (totals.size === 0) return '-'
  return [...totals].sort((left, right) => right[1] - left[1]).map(([code, value]) => formatMoney(value, code, language)).join(' + ')
}

function percent(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 100)
}

function rank(records: VinylRecord[], key: (record: VinylRecord) => string | null | undefined, limit = TOP_COUNT): Ranked[] {
  const counts = new Map<string, number>()
  for (const record of records) {
    const value = key(record)?.trim()
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }))
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** One-hue horizontal bar list: label, bar proportional to the largest count, value. */
function RankedList({ title, items, emptyText, countLabel }: { title: string; items: Ranked[]; emptyText: string; countLabel: string }) {
  const max = Math.max(1, ...items.map((item) => item.count))
  return (
    <section className="rounded-md border bg-background px-3 py-2.5">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`} title={`${item.label}: ${item.hint ?? countLabel.replace('{count}', String(item.count))}`} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm">
              <span className="truncate">{item.label}</span>
              <span className="h-2 rounded-full bg-muted" aria-hidden="true">
                <span className="block h-2 rounded-full bg-primary" style={{ width: `${(item.count / max) * 100}%` }} />
              </span>
              <span className="tabular-nums text-muted-foreground">{item.hint ?? item.count}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Collapsed-by-default stats above the admin table; content depends on the active view. */
export function AdminDashboard({ records, view, language }: { records: VinylRecord[]; view: AdminView; language: Language }) {
  const t = translations[language].dashboard
  const [isOpen, setIsOpen] = useState(readOpenState)

  const stats = useMemo(() => {
    const total = records.length
    const unsold = records.filter((record) => !record.sold)
    const inStore = records.filter((record) => storeExclusion(record) === null)
    const sold = records.filter((record) => record.sold)
    const unsoldPriced = unsold.filter((record) => record.discogs_market_price != null)
    const marketCurrency = (record: VinylRecord) => record.discogs_market_currency
    const marketTotals = sumByCurrency(unsoldPriced, (record) => record.discogs_market_price, marketCurrency)
    const averageTotals = new Map<string, number>()
    const countsByCurrency = new Map<string, number>()
    for (const record of unsoldPriced) {
      const code = record.discogs_market_currency || 'USD'
      countsByCurrency.set(code, (countsByCurrency.get(code) ?? 0) + 1)
    }
    for (const [code, value] of marketTotals) averageTotals.set(code, value / (countsByCurrency.get(code) ?? 1))

    const decades = new Map<string, number>()
    for (const record of records) {
      const year = record.year_pressed
      const key = year ? `${Math.floor(year / 10) * 10}s` : t.unknownYear
      decades.set(key, (decades.get(key) ?? 0) + 1)
    }

    return {
      total,
      synced: records.filter((record) => record.discogs_synced_at).length,
      linked: records.filter((record) => record.discogs_link).length,
      facebook: records.filter(isOnFacebookMarketplace).length,
      sold: sold.length,
      willingToSell: records.filter((record) => record.sell_possibility && !record.sold).length,
      originals: records.filter((record) => record.is_original).length,
      decades: [...decades]
        // Chronological, with records without a year last.
        .sort((left, right) => (left[0] === t.unknownYear ? 1 : right[0] === t.unknownYear ? -1 : left[0].localeCompare(right[0])))
        .map(([label, count]) => ({ label, count })),
      artists: rank(records, (record) => record.artist),
      labels: rank(records, (record) => record.record_label),
      genres: rank(records, (record) => record.genre),
      inStoreCount: inStore.length,
      storeValue: inStore.reduce((sum, record) => sum + Number(record.sale_price_cad ?? 0), 0),
      marketTotals,
      lowestTotals: sumByCurrency(unsold, (record) => record.discogs_lowest_price, marketCurrency),
      lowestCount: unsold.filter((record) => record.discogs_lowest_price != null).length,
      averageTotals,
      unsoldPricedCount: unsoldPriced.length,
      unsoldCount: unsold.length,
      soldValue: sold.reduce((sum, record) => sum + Number(record.sale_price_cad ?? 0), 0),
      statusCounts: {
        inStore: inStore.length,
        sold: sold.length,
        notForSale: records.filter((record) => storeExclusion(record) === 'notForSale').length,
        noPrice: records.filter((record) => storeExclusion(record) === 'noPrice').length,
      },
      mostValuable: [...unsoldPriced]
        .sort((left, right) => Number(right.discogs_market_price) - Number(left.discogs_market_price))
        .slice(0, 5),
    }
  }, [records, t.unknownYear])

  function toggle() {
    const next = !isOpen
    setIsOpen(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // Remembering the state is only a convenience.
    }
  }

  const storeValue = formatMoney(stats.storeValue, 'CAD', language)
  const summary = view === 'inventory'
    ? t.inventorySummary.replace('{total}', String(stats.total)).replace('{synced}', String(percent(stats.synced, stats.total)))
    : t.salesSummary.replace('{storeValue}', storeValue).replace('{inStore}', String(stats.inStoreCount))
  const ofTotal = (count: number) => t.ofTotal.replace('{percent}', String(percent(count, stats.total))).replace('{total}', String(stats.total))

  return (
    <section className="mb-5 rounded-md border bg-card shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={isOpen}
        aria-controls="admin-dashboard-panel"
        title={isOpen ? t.hide : t.show}
        onClick={toggle}
      >
        <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t.title}</span>
        <span className="truncate text-muted-foreground">{summary}</span>
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div id="admin-dashboard-panel" className="space-y-3 border-t px-4 py-4">
          {view === 'inventory' ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <StatTile label={t.totalRecords} value={String(stats.total)} />
                <StatTile label={t.syncedWithDiscogs} value={String(stats.synced)} hint={ofTotal(stats.synced)} />
                <StatTile label={t.withDiscogsLink} value={String(stats.linked)} hint={ofTotal(stats.linked)} />
                <StatTile label={t.onFacebook} value={String(stats.facebook)} hint={ofTotal(stats.facebook)} />
                <StatTile label={t.sold} value={String(stats.sold)} hint={ofTotal(stats.sold)} />
                <StatTile label={t.originalPressings} value={String(stats.originals)} hint={ofTotal(stats.originals)} />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                <RankedList title={t.byDecade} items={stats.decades} emptyText={t.empty} countLabel={t.records} />
                <RankedList title={t.topArtists} items={stats.artists} emptyText={t.empty} countLabel={t.records} />
                <RankedList title={t.topLabels} items={stats.labels} emptyText={t.empty} countLabel={t.records} />
                <RankedList title={t.topGenres} items={stats.genres} emptyText={t.empty} countLabel={t.records} />
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <StatTile label={t.storeValue} value={storeValue} hint={t.storeValueHint.replace('{count}', String(stats.inStoreCount))} />
                <StatTile label={t.discogsMarketValue} value={formatTotals(stats.marketTotals, language)} hint={t.unsoldHint.replace('{count}', String(stats.unsoldPricedCount))} />
                <StatTile label={t.discogsMinimumValue} value={formatTotals(stats.lowestTotals, language)} hint={t.unsoldHint.replace('{count}', String(stats.lowestCount))} />
                <StatTile label={t.averagePrice} value={formatTotals(stats.averageTotals, language)} hint={t.averagePriceHint} />
                <StatTile label={t.soldValue} value={String(stats.sold)} hint={t.soldValueHint.replace('{value}', formatMoney(stats.soldValue, 'CAD', language))} />
                <StatTile
                  label={t.priceCoverage}
                  value={`${percent(stats.unsoldPricedCount, stats.unsoldCount)}%`}
                  hint={t.priceCoverageHint.replace('{count}', String(stats.unsoldCount - stats.unsoldPricedCount))}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                <RankedList
                  title={t.storeStatus}
                  items={[
                    { label: t.inStore, count: stats.statusCounts.inStore },
                    { label: t.sold, count: stats.statusCounts.sold },
                    { label: t.noPrice, count: stats.statusCounts.noPrice },
                    { label: t.notForSale, count: stats.statusCounts.notForSale },
                  ]}
                  emptyText={t.empty}
                  countLabel={t.records}
                />
                <RankedList
                  title={t.mostValuable}
                  items={stats.mostValuable.map((record) => ({
                    label: [record.artist, record.title].filter(Boolean).join(' - ') || '-',
                    count: Number(record.discogs_market_price),
                    hint: formatMoney(Number(record.discogs_market_price), record.discogs_market_currency || 'USD', language),
                  }))}
                  emptyText={t.empty}
                  countLabel={t.records}
                />
                <RankedList title={t.topArtists} items={rank(records.filter((record) => storeExclusion(record) === null), (record) => record.artist, 5)} emptyText={t.empty} countLabel={t.records} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
