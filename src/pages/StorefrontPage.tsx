import { useEffect, useMemo, useState } from 'react'
import { CatalogFilters } from '@/components/storefront/CatalogFilters'
import { CatalogGrid } from '@/components/storefront/CatalogGrid'
import { HeroCarousel } from '@/components/storefront/HeroCarousel'
import { fetchCatalog, interpolate, shuffle, type CatalogRecord } from '@/lib/catalog'
import { ALL, EMPTY_FILTERS, useStorefrontLanguage, type CatalogFilterOptions, type CatalogFilterValues } from '@/lib/storefront'

function distinct(values: (string | number | null | undefined)[]) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== '').map(String))]
}

export default function StorefrontPage() {
  const { t, app } = useStorefrontLanguage()
  const [records, setRecords] = useState<CatalogRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filters, setFilters] = useState<CatalogFilterValues>(EMPTY_FILTERS)

  useEffect(() => {
    document.title = app.title
  }, [app.title])

  useEffect(() => {
    let cancelled = false
    fetchCatalog()
      .then((data) => {
        if (!cancelled) setRecords(data)
      })
      .catch((fetchError: unknown) => {
        console.error('Failed to load catalog', fetchError)
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Shuffled once per page load.
  const heroes = useMemo(() => shuffle(records.filter((record) => record.is_hero)), [records])

  const options = useMemo<CatalogFilterOptions>(() => ({
    genres: distinct(records.map((record) => record.genre)).sort((a, b) => a.localeCompare(b)),
    years: distinct(records.map((record) => record.year_pressed)).sort((a, b) => Number(b) - Number(a)),
    conditions: distinct(records.map((record) => record.media_condition)).sort((a, b) => a.localeCompare(b)),
    owners: distinct(records.map((record) => record.collection_owner)).sort((a, b) => a.localeCompare(b)),
  }), [records])

  const filtered = useMemo(() => {
    const artistQuery = filters.artist.trim().toLocaleLowerCase()
    return records.filter((record) => (
      (!artistQuery || (record.artist ?? '').toLocaleLowerCase().includes(artistQuery))
      && (filters.genre === ALL || record.genre === filters.genre)
      && (filters.year === ALL || String(record.year_pressed) === filters.year)
      && (filters.condition === ALL || record.media_condition === filters.condition)
      && (filters.owner === ALL || record.collection_owner === filters.owner)
    ))
  }, [records, filters])

  return (
    <>
      {heroes.length > 0 && <HeroCarousel records={heroes} />}
      <section className="mx-auto max-w-screen-2xl px-4 pt-12 md:px-10 md:pt-16" aria-labelledby="catalog-title">
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <h1 id="catalog-title" className="text-3xl font-bold tracking-tight md:text-4xl">{t.catalogTitle}</h1>
          {!loading && !error && (
            <p className="font-mono-ui text-xs uppercase tracking-[0.12em] text-store-muted" aria-live="polite">
              {interpolate(t.resultsCount, { count: filtered.length })}
            </p>
          )}
        </div>
        {!loading && !error && records.length > 0 && (
          <div className="mb-10">
            <CatalogFilters values={filters} options={options} onChange={setFilters} />
          </div>
        )}
        <CatalogGrid
          key={JSON.stringify(filters)}
          records={filtered}
          loading={loading}
          error={error}
          hasAnyRecords={records.length > 0}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
        />
      </section>
    </>
  )
}
