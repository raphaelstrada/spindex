import { useState } from 'react'
import { RecordCard } from '@/components/storefront/RecordCard'
import type { CatalogRecord } from '@/lib/catalog'
import { storeSecondaryButton, useStorefrontLanguage } from '@/lib/storefront'

type CatalogGridProps = {
  records: CatalogRecord[]
  loading: boolean
  error: boolean
  hasAnyRecords: boolean
  onClearFilters: () => void
}

const SKELETON_COUNT = 8
const PAGE_SIZE = 48

export function CatalogGrid({ records, loading, error, hasAnyRecords, onClearFilters }: CatalogGridProps) {
  const { t } = useStorefrontLanguage()
  const [visible, setVisible] = useState(PAGE_SIZE)

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4" aria-busy="true">
        <span className="sr-only" role="status">{t.loading}</span>
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <div key={index} aria-hidden="true">
            <div className="aspect-square animate-pulse bg-store-panel" />
            <div className="mt-3 h-3 w-1/2 animate-pulse bg-store-panel" />
            <div className="mt-2 h-4 w-3/4 animate-pulse bg-store-panel" />
            <div className="mt-2 h-4 w-1/4 animate-pulse bg-store-panel" />
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return <p role="alert" className="py-20 text-center text-store-muted">{t.loadError}</p>
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center gap-6 py-20 text-center" role="status">
        <p className="text-store-muted">{hasAnyRecords ? t.emptyFiltered : t.emptyCatalog}</p>
        {hasAnyRecords && (
          <button type="button" className={storeSecondaryButton} onClick={onClearFilters}>{t.clearFilters}</button>
        )}
      </div>
    )
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
        {records.slice(0, visible).map((record) => (
          <li key={record.id}><RecordCard record={record} /></li>
        ))}
      </ul>
      {records.length > visible && (
        <div className="mt-14 flex justify-center">
          <button type="button" className={storeSecondaryButton} onClick={() => setVisible((count) => count + PAGE_SIZE)}>
            {t.showMore}
          </button>
        </div>
      )}
    </>
  )
}
