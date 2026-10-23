import { useMemo, useState } from 'react'
import { DiscogsCandidatePicker } from '@/components/DiscogsCandidatePicker'
import { RecordForm } from '@/components/RecordForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { searchDiscogsByCatalogNumber, valuesFromRelease, type DiscogsRelease } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'

/** Catalog number -> fuzzy Discogs matches (exact first, then pressing country) -> record form. Same flow as the barcode import. */
export function CatalogNumberRecordImport({
  language,
  onSuccess,
  onSkip,
}: {
  language: Language
  onSuccess: () => void
  onSkip?: () => void
}) {
  const app = translations[language].app
  const photo = translations[language].photoImport
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<DiscogsRelease[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [artistAndTitleOnly, setArtistAndTitleOnly] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    const catalogNumber = query.trim()
    if (!/[\p{L}\p{N}]/u.test(catalogNumber)) {
      setInputError(app.catalogNumberInvalid)
      return
    }

    setInputError(null)
    setSearchedQuery(catalogNumber)
    setIsLoading(true)
    setError(null)
    setCandidates([])
    setSelectedId(null)
    setArtistAndTitleOnly(false)

    try {
      const results = await searchDiscogsByCatalogNumber(catalogNumber)
      setCandidates(results)
      // Results are ranked by match quality: preselect the best one.
      setSelectedId(results[0] ? String(results[0].id) : null)
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : String(searchError))
    } finally {
      setIsLoading(false)
    }
  }

  const selectedRelease = candidates.find((release) => String(release.id) === selectedId)
  const initialValues = useMemo(
    () => (selectedRelease
      ? valuesFromRelease(selectedRelease, artistAndTitleOnly)
      : searchedQuery ? { catalog_number: searchedQuery } : undefined),
    [selectedRelease, artistAndTitleOnly, searchedQuery],
  )

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="catalog-number-search" className="text-sm font-medium">
          {app.catalogNumberLabel}
        </label>
        <div className="flex gap-2">
          <Input
            id="catalog-number-search"
            autoFocus
            autoComplete="off"
            className="font-mono"
            placeholder={app.catalogNumberPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                search()
              }
            }}
          />
          <Button type="button" onClick={search} disabled={isLoading}>
            {app.barcodeManualSubmit}
          </Button>
        </div>
        {inputError && (
          <p role="alert" className="text-sm text-destructive">
            {inputError}
          </p>
        )}
      </div>

      {searchedQuery && (
        <DiscogsCandidatePicker
          key={searchedQuery}
          language={language}
          title={app.catalogNumberResults.replace('{catno}', searchedQuery)}
          hint={app.catalogNumberHint}
          error={error}
          isLoading={isLoading}
          loadingLabel={app.barcodeSearching}
          candidates={candidates}
          selectedId={selectedId}
          emptyMessage={app.catalogNumberNoMatches}
          actionLabel={photo.useRecognizedDetails}
          actionActive={artistAndTitleOnly}
          actionDisabled={!selectedRelease}
          onSelect={(releaseId) => {
            setSelectedId(releaseId)
            setArtistAndTitleOnly(false)
          }}
          onAction={() => setArtistAndTitleOnly(true)}
        />
      )}

      {searchedQuery && !isLoading && (
        <div className="border-t pt-4">
          <RecordForm
            key={`${searchedQuery}-${selectedId ?? 'none'}-${artistAndTitleOnly}`}
            language={language}
            initialValues={initialValues}
            showTopSaveButton={Boolean(selectedRelease)}
            onSuccess={onSuccess}
            onSkip={onSkip}
          />
        </div>
      )}
    </div>
  )
}
