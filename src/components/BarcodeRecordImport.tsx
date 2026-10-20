import { useEffect, useMemo, useState } from 'react'
import { DiscogsCandidatePicker } from '@/components/DiscogsCandidatePicker'
import { RecordForm } from '@/components/RecordForm'
import { Button } from '@/components/ui/button'
import { searchDiscogsByBarcode, type DiscogsRelease } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'
import type { VinylRecord } from '@/lib/record'

function valuesFromRelease(release: DiscogsRelease, artistAndTitleOnly: boolean): Partial<VinylRecord> {
  if (artistAndTitleOnly) {
    return { artist: release.artist, title: release.releaseTitle }
  }

  return {
    artist: release.artist,
    title: release.releaseTitle,
    year_pressed: release.year ?? undefined,
    country_pressed: release.country ?? '',
    record_label: release.label[0] ?? '',
    genre: release.genre ?? '',
    sub_genre: release.subGenre ?? '',
    record_type: release.recordType ?? '',
    record_size: release.recordSize ?? '',
    media_condition: '',
    sleeve_condition: '',
    is_original: false,
    discogs_link: release.url,
    image_url: release.coverImage,
  }
}

/** After a barcode scan: Discogs matches first (same box as the photo import), then the record form. */
export function BarcodeRecordImport({
  language,
  barcode,
  onRescan,
  onSuccess,
}: {
  language: Language
  barcode: string
  onRescan: () => void
  onSuccess: () => void
}) {
  const app = translations[language].app
  const photo = translations[language].photoImport
  const [candidates, setCandidates] = useState<DiscogsRelease[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [artistAndTitleOnly, setArtistAndTitleOnly] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setCandidates([])
    setSelectedId(null)
    setArtistAndTitleOnly(false)

    searchDiscogsByBarcode(barcode)
      .then((results) => {
        if (cancelled) return
        setCandidates(results)
        // Same behavior as the photo import: preselect the first match.
        setSelectedId(results[0] ? String(results[0].id) : null)
      })
      .catch((searchError) => {
        if (!cancelled) setError(searchError instanceof Error ? searchError.message : String(searchError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [barcode])

  const selectedRelease = candidates.find((release) => String(release.id) === selectedId)
  const initialValues = useMemo(
    () => (selectedRelease ? valuesFromRelease(selectedRelease, artistAndTitleOnly) : undefined),
    [selectedRelease, artistAndTitleOnly],
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" role="status">
          {app.barcodeScanned.replace('{code}', barcode)}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onRescan}>
          {app.barcodeScanAgain}
        </Button>
      </div>

      <DiscogsCandidatePicker
        key={barcode}
        language={language}
        title={photo.discogsOptions}
        hint={photo.canadianFirst}
        error={error}
        isLoading={isLoading}
        loadingLabel={app.barcodeSearching}
        candidates={candidates}
        selectedId={selectedId}
        emptyMessage={app.barcodeNoMatches}
        actionLabel={photo.useRecognizedDetails}
        actionActive={artistAndTitleOnly}
        actionDisabled={!selectedRelease}
        onSelect={(releaseId) => {
          setSelectedId(releaseId)
          setArtistAndTitleOnly(false)
        }}
        onAction={() => setArtistAndTitleOnly(true)}
      />

      {!isLoading && (
        <div className="border-t pt-4">
          <RecordForm
            key={`${selectedId ?? 'none'}-${artistAndTitleOnly}`}
            language={language}
            initialValues={initialValues}
            showTopSaveButton={Boolean(selectedRelease)}
            onSuccess={onSuccess}
          />
        </div>
      )}
    </div>
  )
}
