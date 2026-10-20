import { useMemo, useState } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { countryRank, type DiscogsRelease } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'

/**
 * Shared "possible Discogs releases" box, shown ABOVE the record form.
 * Used by the photo import and the barcode import so both look and behave the same.
 * Receives ALL matches (already sorted by pressing country) and lets the user filter by country/year.
 * Render it with a `key` that changes whenever the candidate list is for a different record.
 */
export function DiscogsCandidatePicker({
  language,
  title,
  hint,
  error,
  isLoading = false,
  loadingLabel,
  candidates,
  selectedId,
  emptyMessage,
  actionLabel,
  actionActive = false,
  actionDisabled = false,
  onSelect,
  onAction,
}: {
  language: Language
  title: string
  hint?: string
  error?: string | null
  isLoading?: boolean
  loadingLabel?: string
  candidates: DiscogsRelease[]
  selectedId: string | null
  emptyMessage: string
  actionLabel: string
  actionActive?: boolean
  actionDisabled?: boolean
  onSelect: (releaseId: string) => void
  onAction: () => void
}) {
  const t = translations[language].form
  const [countryFilter, setCountryFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')

  const countries = useMemo(
    () => [...new Set(candidates.map((release) => release.country).filter((country): country is string => Boolean(country)))]
      .sort((left, right) => countryRank(left) - countryRank(right) || left.localeCompare(right)),
    [candidates],
  )
  const years = useMemo(
    () => [...new Set(candidates.map((release) => release.year).filter((year): year is number => year !== null))]
      .sort((left, right) => right - left),
    [candidates],
  )
  const visibleCandidates = useMemo(
    () => candidates.filter((release) =>
      (countryFilter === 'all' || release.country === countryFilter)
      && (yearFilter === 'all' || String(release.year) === yearFilter),
    ),
    [candidates, countryFilter, yearFilter],
  )
  const hasFilters = countryFilter !== 'all' || yearFilter !== 'all'

  function clearFilters() {
    setCountryFilter('all')
    setYearFilter('all')
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          {loadingLabel}
        </p>
      ) : candidates.length > 0 ? (
        <>
          {candidates.length > 1 && (
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="picker-country-filter">{t.filterCountry}</Label>
                <Select value={countryFilter} onValueChange={setCountryFilter}>
                  <SelectTrigger id="picker-country-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.allCountries}</SelectItem>
                    {countries.map((country) => (
                      <SelectItem key={country} value={country}>{country}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="picker-year-filter">{t.filterYear}</Label>
                <Select value={yearFilter} onValueChange={setYearFilter}>
                  <SelectTrigger id="picker-year-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.allYears}</SelectItem>
                    {years.map((year) => (
                      <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasFilters && (
                <Button type="button" variant="outline" onClick={clearFilters}>
                  {t.clearDiscogsFilters}
                </Button>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground" role="status">
            {t.discogsResultsCount
              .replace('{shown}', String(visibleCandidates.length))
              .replace('{total}', String(candidates.length))}
          </p>

          {visibleCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noFilteredDiscogsMatches}</p>
          ) : (
            <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {visibleCandidates.map((release) => {
                const isSelected = selectedId === String(release.id)
                return (
                  <button
                    key={release.id}
                    type="button"
                    className={`flex min-w-0 items-center gap-3 rounded-md border p-2 text-left transition-colors hover:bg-accent ${isSelected ? 'border-primary bg-accent/50' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelect(String(release.id))}
                  >
                    <img src={release.thumbnail} alt="" className="h-14 w-14 shrink-0 rounded-sm object-cover" loading="lazy" />
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2 text-sm font-medium">{release.title}</span>
                      {release.catalogNumber && <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">{release.catalogNumber}</span>}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {[release.year, release.country, release.format.join(', '), release.label[0]].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      )}

      <Button
        type="button"
        variant={actionActive ? 'secondary' : 'outline'}
        size="sm"
        disabled={actionDisabled || isLoading}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </section>
  )
}
