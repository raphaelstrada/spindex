import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, ImagePlus, Link2, LoaderCircle, Trash2 } from 'lucide-react'
import { RecordForm } from '@/components/RecordForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { supabase } from '@/lib/supabase'
import { searchDiscogsReleases, type DiscogsRelease } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'
import type { VinylRecord } from '@/lib/record'

type MarketplaceContext = {
  sourceUrl: string
  listingTitle: string
  description: string
  askingPrice: number | null
  currency: string | null
}

type Photo = {
  id: string
  file: File
  previewUrl: string
  marketplaceContext?: MarketplaceContext
}

type DetectedRecord = {
  id: string
  artist: string
  title: string
  year: number | null
  imageIndex: number
  confidence: 'high' | 'medium' | 'low'
  sourceUrl: string | null
  marketplacePrice: number | null
  marketplaceCurrency: string | null
  candidates: DiscogsRelease[]
  selectedReleaseId: string
  discogsError?: string
}

type EncodedImage = {
  mediaType: string
  dataBase64: string
}

type MarketplaceListingResponse = {
  sourceUrl: string
  listingTitle: string
  description: string
  askingPrice: number | null
  currency: string | null
  images: EncodedImage[]
}

const marketplaceBridgeUrl = 'http://127.0.0.1:8765/api/marketplace-listings'
const maxMarketplaceUrls = 10
const maxMarketplacePhotos = 30

function encodePhoto(file: File): Promise<EncodedImage> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('Could not process this image.'))
        return
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(objectUrl)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Could not process this image.'))
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result)
          resolve({ mediaType: blob.type, dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) })
        }
        reader.onerror = () => reject(new Error('Could not read this image.'))
        reader.readAsDataURL(blob)
      }, 'image/jpeg', 0.82)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('This image format is not supported by the browser.'))
    }
    image.src = objectUrl
  })
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function rankReleases(releases: DiscogsRelease[], detected: Pick<DetectedRecord, 'artist' | 'title' | 'year'>) {
  const uniqueReleases = [...new Map(releases.map((release) => [release.id, release])).values()]

  return uniqueReleases
    .map((release) => ({
      release,
      score: Number(release.country?.toLocaleLowerCase() === 'canada') * 100
        + Number(normalize(release.artist) === normalize(detected.artist)) * 8
        + Number(normalize(release.releaseTitle) === normalize(detected.title)) * 8
        + Number(detected.year !== null && release.year === detected.year) * 2,
    }))
    .sort((left, right) => right.score - left.score || left.release.title.localeCompare(right.release.title))
    .slice(0, 8)
    .map(({ release }) => release)
}

function releaseFormValues(release: DiscogsRelease | undefined, detected: DetectedRecord): Partial<VinylRecord> {
  if (!release) {
    return {
      artist: detected.artist,
      title: detected.title,
      year_pressed: detected.year,
      source_url: detected.sourceUrl ?? '',
      marketplace_price: detected.marketplacePrice ?? undefined,
      marketplace_currency: detected.marketplaceCurrency ?? '',
    }
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
    source_url: detected.sourceUrl ?? '',
    marketplace_price: detected.marketplacePrice ?? undefined,
    marketplace_currency: detected.marketplaceCurrency ?? '',
  }
}

export function PhotoRecordImport({ language, onRecordSaved, onClose }: {
  language: Language
  onRecordSaved: () => void
  onClose: () => void
}) {
  const t = translations[language].photoImport
  const [photos, setPhotos] = useState<Photo[]>([])
  const [records, setRecords] = useState<DetectedRecord[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [savedCount, setSavedCount] = useState(0)
  const [stage, setStage] = useState<'select' | 'review' | 'done'>('select')
  const [isIdentifying, setIsIdentifying] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [marketplaceLinks, setMarketplaceLinks] = useState('')
  const [marketplaceBridgeToken, setMarketplaceBridgeToken] = useState('')
  const [isFetchingMarketplace, setIsFetchingMarketplace] = useState(false)
  const [marketplaceProgress, setMarketplaceProgress] = useState('')
  const uploadInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const previewUrls = useRef(new Set<string>())
  const uploadedPhotoUrls = useRef(new Map<string, string>())
  const activeRecord = records[currentIndex]
  const selectedRelease = activeRecord?.candidates.find((release) => String(release.id) === activeRecord.selectedReleaseId)
  const initialValues = useMemo(
    () => activeRecord ? releaseFormValues(selectedRelease, activeRecord) : undefined,
    [activeRecord, selectedRelease],
  )
  const sourcePhoto = activeRecord ? photos[activeRecord.imageIndex] : undefined

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url))
    previewUrls.current.clear()
  }, [])

  function addPhotos(fileList: FileList | null) {
    if (!fileList) return
    const additions = Array.from(fileList)
      .filter((file) => file.type.startsWith('image/'))
      .map((file) => {
        const previewUrl = URL.createObjectURL(file)
        previewUrls.current.add(previewUrl)
        return { id: crypto.randomUUID(), file, previewUrl }
      })
    setPhotos((current) => [...current, ...additions])
    setError(null)
  }

  function removePhoto(photo: Photo) {
    URL.revokeObjectURL(photo.previewUrl)
    previewUrls.current.delete(photo.previewUrl)
    setPhotos((current) => current.filter((item) => item.id !== photo.id))
  }

  async function importMarketplaceListings() {
    const urls = marketplaceLinks.split(/[\s,]+/).map((url) => url.trim()).filter(Boolean)
    if (urls.length === 0 || !marketplaceBridgeToken.trim()) {
      setError(t.marketplaceInputRequired)
      return
    }
    if (urls.length > maxMarketplaceUrls) {
      setError(t.marketplaceTooManyUrls.replace('{count}', String(maxMarketplaceUrls)))
      return
    }

    setError(null)
    setIsFetchingMarketplace(true)
    const additions: Photo[] = []
    const errors: string[] = []

    try {
      for (const [index, url] of urls.entries()) {
        setMarketplaceProgress(`${t.fetchingMarketplace} ${index + 1}/${urls.length}`)
        try {
          const response = await fetch(marketplaceBridgeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Marketplace-Bridge-Token': marketplaceBridgeToken.trim(),
            },
            body: JSON.stringify({ urls: [url] }),
          })
          const payload = await response.json().catch(() => null) as {
            error?: string
            listings?: MarketplaceListingResponse[]
          } | null
          if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)

          for (const listing of payload?.listings ?? []) {
            const listingContext: MarketplaceContext = {
              sourceUrl: listing.sourceUrl,
              listingTitle: listing.listingTitle,
              description: listing.description,
              askingPrice: listing.askingPrice,
              currency: listing.currency,
            }
            for (const [imageIndex, image] of listing.images.entries()) {
              const bytes = Uint8Array.from(atob(image.dataBase64), (character) => character.charCodeAt(0))
              const extension = image.mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'img'
              const file = new File([bytes], `marketplace-${index + 1}-${imageIndex + 1}.${extension}`, { type: image.mediaType })
              const previewUrl = URL.createObjectURL(file)
              previewUrls.current.add(previewUrl)
              additions.push({
                id: crypto.randomUUID(),
                file,
                previewUrl,
                marketplaceContext: listingContext,
              })
            }
          }
        } catch (listingError) {
          errors.push(listingError instanceof Error ? listingError.message : t.marketplaceFetchFailed)
        }
      }

      if (photos.length + additions.length > maxMarketplacePhotos) {
        additions.forEach((photo) => {
          URL.revokeObjectURL(photo.previewUrl)
          previewUrls.current.delete(photo.previewUrl)
        })
        setError(t.marketplaceTooManyPhotos.replace('{count}', String(maxMarketplacePhotos)))
        return
      }

      if (additions.length > 0) setPhotos((current) => [...current, ...additions])
      if (errors.length > 0) setError(errors.join(' '))
      else if (additions.length === 0) setError(t.marketplaceNoPhotos)
    } finally {
      setMarketplaceProgress('')
      setIsFetchingMarketplace(false)
    }
  }

  async function uploadOriginalPhoto(photo: Photo) {
    const cachedUrl = uploadedPhotoUrls.current.get(photo.id)
    if (cachedUrl) return cachedUrl

    const extensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heif',
    }
    const extension = extensions[photo.file.type]
    if (!extension) throw new Error(t.unsupportedOriginalPhotoType)

    const path = `${photo.id}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from('vinyl-originals')
      .upload(path, photo.file, {
        cacheControl: '31536000',
        contentType: photo.file.type,
        upsert: false,
      })

    if (uploadError) throw new Error(uploadError.message)

    const { data } = supabase.storage.from('vinyl-originals').getPublicUrl(path)
    uploadedPhotoUrls.current.set(photo.id, data.publicUrl)
    return data.publicUrl
  }

  async function identifyRecords() {
    if (photos.length === 0) return

    // This action spends paid Gemini tokens, so it requires a PIN.
    const PAID_ACTION_PIN = '1212'
    const pin = window.prompt(t.paidActionPinPrompt)?.trim() ?? ''
    if (!pin) return
    if (pin !== PAID_ACTION_PIN) {
      const retry = window.prompt(t.paidActionPinInvalid)?.trim() ?? ''
      if (retry !== PAID_ACTION_PIN) return
    }

    setError(null)
    setIsIdentifying(true)
    setProgress(t.preparingPhotos)

    try {
      const encodedImages: EncodedImage[] = []
      for (const photo of photos) encodedImages.push(await encodePhoto(photo.file))

      const detectedRecords: Omit<DetectedRecord, 'candidates' | 'selectedReleaseId'>[] = []
      for (let offset = 0; offset < encodedImages.length; offset += 2) {
        setProgress(`${t.identifyingPhotos} ${Math.min(offset + 2, encodedImages.length)}/${encodedImages.length}`)
        const { data, error: invokeError } = await supabase.functions.invoke<{
          records: Array<{
            artist: string
            title: string
            year: number | null
            imageIndex: number
            confidence: 'high' | 'medium' | 'low'
            marketplacePrice?: number | null
            marketplaceCurrency?: string | null
          }>
        }>('identify-records', {
          body: {
            images: encodedImages.slice(offset, offset + 2).map((image, index) => ({
              ...image,
              listingContext: photos[offset + index]?.marketplaceContext,
            })),
          },
        })

        if (invokeError) {
          if (invokeError.context instanceof Response) {
            const details = await invokeError.context.json().catch(() => null) as { error?: string } | null
            throw new Error(details?.error || invokeError.message)
          }
          throw new Error(invokeError.message)
        }

        for (const item of data?.records ?? []) {
          if (!item.artist?.trim() || !item.title?.trim()) continue
          const imageIndex = item.imageIndex + offset
          const listingContext = photos[imageIndex]?.marketplaceContext
          detectedRecords.push({
            id: crypto.randomUUID(),
            artist: item.artist.trim(),
            title: item.title.trim(),
            year: item.year,
            imageIndex,
            confidence: item.confidence,
            sourceUrl: listingContext?.sourceUrl ?? null,
            marketplacePrice: item.marketplacePrice ?? listingContext?.askingPrice ?? null,
            marketplaceCurrency: item.marketplaceCurrency ?? listingContext?.currency ?? null,
          })
        }
      }

      if (detectedRecords.length === 0) {
        setError(t.noRecordsIdentified)
        return
      }

      const reviewedRecords: DetectedRecord[] = []
      for (const [index, detected] of detectedRecords.entries()) {
        setProgress(`${t.searchingDiscogs} ${index + 1}/${detectedRecords.length}`)
        let results: DiscogsRelease[] = []
        let discogsError: string | undefined
        try {
          results = await searchDiscogsReleases(detected.artist, detected.title, undefined, {
            year: detected.year ?? undefined,
          })
          if (!results.some((release) => release.country?.toLocaleLowerCase() === 'canada')) {
            const canadianResults = await searchDiscogsReleases(detected.artist, detected.title, undefined, {
              country: 'Canada',
              year: detected.year ?? undefined,
            })
            results = [...canadianResults, ...results]
          }
        } catch (searchError) {
          discogsError = searchError instanceof Error ? searchError.message : t.discogsSearchFailed
        }

        const candidates = rankReleases(results, detected)
        reviewedRecords.push({
          ...detected,
          candidates,
          selectedReleaseId: candidates[0] ? String(candidates[0].id) : 'manual',
          discogsError,
        })
      }

      setRecords(reviewedRecords)
      setCurrentIndex(0)
      setStage('review')
    } catch (identifyError) {
      setError(identifyError instanceof Error ? identifyError.message : t.identificationFailed)
    } finally {
      setProgress('')
      setIsIdentifying(false)
    }
  }

  function chooseRelease(recordId: string, releaseId: string) {
    setRecords((current) => current.map((record) => record.id === recordId
      ? { ...record, selectedReleaseId: releaseId }
      : record,
    ))
  }

  function advanceRecord(saved: boolean) {
    if (saved) {
      setSavedCount((count) => count + 1)
      onRecordSaved()
    }
    if (currentIndex + 1 < records.length) setCurrentIndex((index) => index + 1)
    else setStage('done')
  }

  if (stage === 'done') {
    return (
      <div className="space-y-5 py-6 text-center">
        <Check className="mx-auto h-10 w-10 text-brand-green" aria-hidden="true" />
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{t.completeTitle}</h3>
          <details className="rounded-md border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">{t.linkToMarketplace}</summary>
            <div className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground">{t.marketplaceBridgeHelp}</p>
              <div className="space-y-2">
                <Label htmlFor="marketplace-bridge-token">{t.marketplaceBridgeToken}</Label>
                <Input
                  id="marketplace-bridge-token"
                  type="password"
                  autoComplete="off"
                  value={marketplaceBridgeToken}
                  onChange={(event) => setMarketplaceBridgeToken(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="marketplace-links">{t.marketplaceLinksLabel}</Label>
                <Textarea
                  id="marketplace-links"
                  rows={4}
                  className="resize-y"
                  value={marketplaceLinks}
                  onChange={(event) => setMarketplaceLinks(event.target.value)}
                  placeholder={t.marketplaceLinksPlaceholder}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {marketplaceProgress && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {marketplaceProgress}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={isFetchingMarketplace || !marketplaceLinks.trim() || !marketplaceBridgeToken.trim()}
                  onClick={() => void importMarketplaceListings()}
                >
                  {isFetchingMarketplace
                    ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                    : <Link2 aria-hidden="true" />}
                  {isFetchingMarketplace ? t.fetchingMarketplace : t.fetchMarketplacePhotos}
                </Button>
              </div>
            </div>
          </details>
          <details className="rounded-md border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">{t.linkToMarketplace}</summary>
            <div className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground">{t.marketplaceBridgeHelp}</p>
              <div className="space-y-2">
                <Label htmlFor="marketplace-bridge-token">{t.marketplaceBridgeToken}</Label>
                <Input
                  id="marketplace-bridge-token"
                  type="password"
                  autoComplete="off"
                  value={marketplaceBridgeToken}
                  onChange={(event) => setMarketplaceBridgeToken(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="marketplace-links">{t.marketplaceLinksLabel}</Label>
                <Textarea
                  id="marketplace-links"
                  rows={4}
                  className="resize-y"
                  value={marketplaceLinks}
                  onChange={(event) => setMarketplaceLinks(event.target.value)}
                  placeholder={t.marketplaceLinksPlaceholder}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {marketplaceProgress && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {marketplaceProgress}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={isFetchingMarketplace || !marketplaceLinks.trim() || !marketplaceBridgeToken.trim()}
                  onClick={() => void importMarketplaceListings()}
                >
                  {isFetchingMarketplace
                    ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                    : <Link2 aria-hidden="true" />}
                  {isFetchingMarketplace ? t.fetchingMarketplace : t.fetchMarketplacePhotos}
                </Button>
              </div>
            </div>
          </details>
          <p className="text-sm text-muted-foreground">{t.savedRecords}: {savedCount}/{records.length}</p>
        </div>
        <Button type="button" onClick={onClose}>{t.closeImport}</Button>
      </div>
    )
  }

  if (stage === 'review' && activeRecord) {
    const confidenceLabel = activeRecord.confidence === 'high'
      ? t.confidenceHigh
      : activeRecord.confidence === 'low'
        ? t.confidenceLow
        : t.confidenceMedium

    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {t.recordStep} {currentIndex + 1} / {records.length}
            </p>
            <h3 className="mt-1 text-lg font-semibold">{activeRecord.artist} — {activeRecord.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.recognitionConfidence}: {confidenceLabel}</p>
          </div>
          {sourcePhoto && (
            <img src={sourcePhoto.previewUrl} alt="" className="h-20 w-20 shrink-0 rounded-md border object-cover" />
          )}
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{t.discogsOptions}</h4>
            <span className="text-xs text-muted-foreground">{t.canadianFirst}</span>
          </div>
          {activeRecord.discogsError && (
            <p role="alert" className="text-sm text-destructive">{activeRecord.discogsError}</p>
          )}
          {activeRecord.candidates.length > 0 ? (
            <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {activeRecord.candidates.map((release) => {
                const isSelected = activeRecord.selectedReleaseId === String(release.id)
                return (
                  <button
                    key={release.id}
                    type="button"
                    className={`flex min-w-0 items-center gap-3 rounded-md border p-2 text-left transition-colors hover:bg-accent ${isSelected ? 'border-primary bg-accent/50' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => chooseRelease(activeRecord.id, String(release.id))}
                  >
                    <img src={release.thumbnail} alt="" className="h-14 w-14 shrink-0 rounded-sm object-cover" loading="lazy" />
                    <span className="min-w-0 flex-1">
                      <span className="block line-clamp-2 text-sm font-medium">{release.title}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {[release.year, release.country, release.format.join(', '), release.label[0]].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t.noDiscogsOptions}</p>
          )}
          <Button
            type="button"
            variant={activeRecord.selectedReleaseId === 'manual' ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => chooseRelease(activeRecord.id, 'manual')}
          >
            {t.useRecognizedDetails}
          </Button>
        </section>

        <div className="border-t pt-4">
          <RecordForm
            key={`${activeRecord.id}-${activeRecord.selectedReleaseId}`}
            language={language}
            initialValues={initialValues}
            showTopSaveButton={Boolean(selectedRelease)}
            onUploadOriginalImage={sourcePhoto ? () => uploadOriginalPhoto(sourcePhoto) : undefined}
            onSuccess={() => advanceRecord(true)}
          />
        </div>
        <div className="flex justify-end border-t pt-3">
          <Button type="button" variant="ghost" onClick={() => advanceRecord(false)}>
            {t.skipRecord}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t.photoPrivacy}</p>
      <details className="rounded-md border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">{t.linkToMarketplace}</summary>
        <div className="space-y-3 pt-4">
          <p className="text-sm text-muted-foreground">{t.marketplaceBridgeHelp}</p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              {t.marketplaceStepGetFiles}{' '}
              <a
                href="https://github.com/raphaelstrada/spindex/releases/tag/marketplace-helper-latest"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-4"
              >
                {t.marketplaceHelperRepository}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">{t.marketplaceMacChipHint}</p>
            </li>
            <li>{t.marketplaceStepLogin}</li>
            <li>{t.marketplaceStepRunBridge}</li>
            <li>{t.marketplaceStepPaste}</li>
          </ol>
          <p className="text-xs text-muted-foreground">{t.marketplaceNoFacebookApiToken}</p>
          <p className="text-xs text-muted-foreground">{t.marketplaceUnsignedWarning}</p>
          <p className="text-xs text-muted-foreground">{t.marketplaceLocalNetworkPermission}</p>
          <div className="space-y-2">
            <Label htmlFor="marketplace-bridge-token">{t.marketplaceBridgeToken}</Label>
            <Input
              id="marketplace-bridge-token"
              type="password"
              autoComplete="off"
              value={marketplaceBridgeToken}
              onChange={(event) => setMarketplaceBridgeToken(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="marketplace-links">{t.marketplaceLinksLabel}</Label>
            <Textarea
              id="marketplace-links"
              rows={4}
              className="resize-y"
              value={marketplaceLinks}
              onChange={(event) => setMarketplaceLinks(event.target.value)}
              placeholder={t.marketplaceLinksPlaceholder}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {marketplaceProgress && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                {marketplaceProgress}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={isFetchingMarketplace || !marketplaceLinks.trim() || !marketplaceBridgeToken.trim()}
              onClick={() => void importMarketplaceListings()}
            >
              {isFetchingMarketplace
                ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                : <Link2 aria-hidden="true" />}
              {isFetchingMarketplace ? t.fetchingMarketplace : t.fetchMarketplacePhotos}
            </Button>
          </div>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <input
          ref={uploadInput}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            addPhotos(event.target.files)
            event.target.value = ''
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            addPhotos(event.target.files)
            event.target.value = ''
          }}
        />
        <Button type="button" variant="outline" onClick={() => uploadInput.current?.click()}>
          <ImagePlus aria-hidden="true" />
          {t.choosePhotos}
        </Button>
        <Button type="button" variant="outline" onClick={() => cameraInput.current?.click()}>
          <Camera aria-hidden="true" />
          {t.takePhoto}
        </Button>
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="relative overflow-hidden rounded-md border bg-card">
              <img src={photo.previewUrl} alt={photo.file.name} className="aspect-square w-full object-cover" />
              <p className="truncate px-2 py-1.5 text-xs text-muted-foreground">{photo.file.name}</p>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-2 top-2 h-8 w-8 shadow-sm"
                aria-label={`${t.removePhoto}: ${photo.file.name}`}
                onClick={() => removePhoto(photo)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {isIdentifying && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          {progress}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" disabled={photos.length === 0 || isIdentifying} onClick={() => void identifyRecords()}>
          {isIdentifying ? t.identifying : t.identifyRecords}
        </Button>
      </div>
    </div>
  )
}