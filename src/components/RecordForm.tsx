import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { AlertCircle, ArrowRight, Disc3, Hash, Images, LoaderCircle, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCollectionOwner, type CollectionOwner } from '@/lib/collection'
import { countryRank, getDiscogsLowestPrice, getDiscogsReleaseId, searchDiscogsByCatalogNumber, searchDiscogsReleases, type DiscogsRelease } from '@/lib/discogs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { translations, type Language } from '@/lib/i18n'
import type { VinylRecord } from '@/lib/record'

function getLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

async function calculateSimilarity(str1: string, str2: string): Promise<number> {
  const a = str1.toLowerCase().trim()
  const b = str2.toLowerCase().trim()
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.length === 0) return 1.0
  const editDistance = getLevenshteinDistance(longer, shorter)
  return (longer.length - editDistance) / longer.length
}

async function checkDuplicateRecord(artist: string, title: string, owner: CollectionOwner): Promise<VinylRecord | null> {
  const { data: records } = await supabase
    .from('vinyl_records')
    .select('*')
    .eq('collection_owner', owner)

  if (!records || records.length === 0) return null

  let bestMatch: { record: VinylRecord; score: number } | null = null
  const threshold = 0.75

  for (const record of records) {
    const artistSimilarity = await calculateSimilarity(artist, record.artist || '')
    const titleSimilarity = await calculateSimilarity(title, record.title || '')
    const combinedScore = (artistSimilarity + titleSimilarity) / 2

    if (combinedScore >= threshold && (!bestMatch || combinedScore > bestMatch.score)) {
      bestMatch = { record, score: combinedScore }
    }
  }

  return bestMatch?.record || null
}

function createFormSchema(language: Language) {
  const t = translations[language].form

  return z.object({
    artist: z.string().min(1, t.artistRequired),
    title: z.string().min(1, t.titleRequired),
    record_label: z.string().optional(),
    genre: z.string().optional(),
    sub_genre: z.string().optional(),
    record_type: z.string().optional(),
    record_size: z.string().optional(),
    year_pressed: z.coerce.number().int().optional(),
    country_pressed: z.string().optional(),
    catalog_number: z.string().optional(),
    media_condition: z.string().optional(),
    sleeve_condition: z.string().optional(),
    is_original: z.boolean().default(true),
    is_special_edition: z.boolean().default(false),
    special_edition_reason: z.string().optional(),
    sell_possibility: z.boolean().default(false),
    sold: z.boolean().default(false),
    is_hero: z.boolean().default(false),
    hero_tagline: z.string().max(90, t.heroTaglineTooLong).optional(),
    discogs_lowest_price: z.coerce.number().nonnegative().optional(),
    marketplace_price: z.preprocess(
      (value) => value === '' || value === null ? undefined : value,
      z.coerce.number().nonnegative().optional(),
    ),
    marketplace_currency: z.string().max(3).optional(),
    notes: z.string().optional(),
    discogs_link: z.string().optional(),
    image_url: z.string().optional(),
    source_url: z.string().optional(),
  })
}

type FormInput = z.input<ReturnType<typeof createFormSchema>>
type FormValues = z.output<ReturnType<typeof createFormSchema>>

export function RecordForm({ language, record, initialValues, showTopSaveButton = false, autoSearchDiscogs = false, startWithDiscogsUrl = false, onUploadPicture, onUploadOriginalImage, onSuccess, onSaveAndNext, onSkip }: {
  language: Language
  record?: VinylRecord
  initialValues?: Partial<VinylRecord>
  showTopSaveButton?: boolean
  autoSearchDiscogs?: boolean
  startWithDiscogsUrl?: boolean
  onUploadPicture?: () => void
  onUploadOriginalImage?: () => Promise<string>
  onSuccess?: (values: FormValues) => void
  onSaveAndNext?: (values: FormValues, addToCollection: boolean) => void
  onSkip?: () => void
}) {
  const t = translations[language].form
  const owner = useCollectionOwner()
  const [discogsSearching, setDiscogsSearching] = useState(false)
  const [discogsResults, setDiscogsResults] = useState<DiscogsRelease[]>([])
  const [discogsSearchError, setDiscogsSearchError] = useState<string | null>(null)
  const [discogsHasSearched, setDiscogsHasSearched] = useState(false)
  const [discogsCountryFilter, setDiscogsCountryFilter] = useState('all')
  const [discogsYearFilter, setDiscogsYearFilter] = useState('all')
  const [discogsPriceLoading, setDiscogsPriceLoading] = useState(false)
  const [discogsPriceLookupComplete, setDiscogsPriceLookupComplete] = useState(false)
  // Manual Discogs lookup next to the artist/title search: a release URL or a (fuzzy) catalog number.
  const [manualDiscogsSearch, setManualDiscogsSearch] = useState<'url' | 'catalogNumber' | null>(startWithDiscogsUrl ? 'url' : null)
  const [discogsUrlInput, setDiscogsUrlInput] = useState('')
  const [catalogNumberInput, setCatalogNumberInput] = useState('')
  const [selectedDiscogsTitle, setSelectedDiscogsTitle] = useState<string | null>(null)
  const [selectedDiscogsRelease, setSelectedDiscogsRelease] = useState<DiscogsRelease | null>(null)
  const [appliedDiscogsFields, setAppliedDiscogsFields] = useState<Set<string>>(new Set())
  const [addToDiscogsCollection, setAddToDiscogsCollection] = useState(true)
  const [duplicateRecord, setDuplicateRecord] = useState<VinylRecord | null>(null)
  const [pendingFormValues, setPendingFormValues] = useState<FormValues | null>(null)
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false)
  const [foundDuplicate, setFoundDuplicate] = useState<VinylRecord | null>(null)
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false)
  const duplicateCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function skipRecord() {
    setDuplicateAcknowledged(true)
    if (onSkip) {
      onSkip()
      return
    }
    form.setValue('artist', '')
    form.setValue('title', '')
    setFoundDuplicate(null)
  }
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(createFormSchema(language)),
    defaultValues: {
      artist: record?.artist ?? initialValues?.artist ?? '',
      title: record?.title ?? initialValues?.title ?? '',
      record_label: record?.record_label ?? initialValues?.record_label ?? '',
      genre: record?.genre ?? initialValues?.genre ?? '',
      sub_genre: record?.sub_genre ?? initialValues?.sub_genre ?? '',
      record_type: record?.record_type ?? initialValues?.record_type ?? '',
      record_size: record?.record_size ?? initialValues?.record_size ?? '',
      year_pressed: record?.year_pressed ?? initialValues?.year_pressed ?? undefined,
      country_pressed: record?.country_pressed ?? initialValues?.country_pressed ?? '',
      catalog_number: record?.catalog_number ?? initialValues?.catalog_number ?? '',
      media_condition: record?.media_condition ?? initialValues?.media_condition ?? '',
      sleeve_condition: record?.sleeve_condition ?? initialValues?.sleeve_condition ?? '',
      is_original: record?.is_original ?? initialValues?.is_original ?? true,
      is_special_edition: record?.is_special_edition ?? false,
      special_edition_reason: record?.special_edition_reason ?? '',
      sell_possibility: record?.sell_possibility ?? initialValues?.sell_possibility ?? false,
      sold: record?.sold ?? false,
      is_hero: record?.is_hero === true,
      hero_tagline: typeof record?.hero_tagline === 'string' ? record.hero_tagline : '',
      discogs_lowest_price: record?.discogs_lowest_price ?? initialValues?.discogs_lowest_price ?? undefined,
      marketplace_price: record?.marketplace_price ?? initialValues?.marketplace_price ?? undefined,
      marketplace_currency: record?.marketplace_currency ?? initialValues?.marketplace_currency ?? '',
      notes: record?.notes ?? initialValues?.notes ?? '',
      discogs_link: record?.discogs_link ?? initialValues?.discogs_link ?? '',
      image_url: record?.image_url ?? initialValues?.image_url ?? '',
      source_url: record?.source_url ?? initialValues?.source_url ?? '',
    },
  })

  async function onSubmit(values: FormValues) {
    if (!record) {
      setIsCheckingDuplicate(true)
      try {
        const duplicate = await checkDuplicateRecord(values.artist, values.title, owner)
        if (duplicate) {
          setDuplicateRecord(duplicate)
          setPendingFormValues(values)
          setIsCheckingDuplicate(false)
          return
        }
      } catch {
        setIsCheckingDuplicate(false)
      }
    }

    await proceedWithSave(values)
  }

  async function proceedWithSave(values: FormValues) {
    let discogsLowestPrice = values.discogs_lowest_price
    const associatedReleaseId = selectedDiscogsRelease?.id ?? getDiscogsReleaseId(values.discogs_link)
    if (associatedReleaseId) {
      try {
        const priceStats = await getDiscogsLowestPrice(associatedReleaseId)
        if (priceStats.lowestPrice !== null) {
          discogsLowestPrice = priceStats.lowestPrice
          form.setValue('discogs_lowest_price', discogsLowestPrice, { shouldDirty: true })
        }
      } catch {
        // Saving the record still works when the price lookup fails.
      }
    }

    let originalImageUrl: string | undefined
    if (onUploadOriginalImage) {
      try {
        originalImageUrl = await onUploadOriginalImage()
      } catch (error) {
        alert(`${t.databaseError} ${error instanceof Error ? error.message : ''}`)
        return
      }
    }

    const valuesToSave = {
      ...values,
      discogs_lowest_price: discogsLowestPrice,
      ...(originalImageUrl ? { original_image_url: originalImageUrl } : {}),
    }
    const releaseChanged = Boolean(record?.discogs_synced_at)
      && getDiscogsReleaseId(record?.discogs_link) !== getDiscogsReleaseId(valuesToSave.discogs_link)
    const databaseValues = {
      ...valuesToSave,
      record_type: valuesToSave.record_type || null,
      record_size: valuesToSave.record_size || null,
      catalog_number: valuesToSave.catalog_number || null,
      media_condition: valuesToSave.media_condition || null,
      sleeve_condition: valuesToSave.sleeve_condition || null,
      marketplace_price: valuesToSave.marketplace_price ?? null,
      marketplace_currency: valuesToSave.marketplace_currency || null,
      hero_tagline: valuesToSave.hero_tagline?.trim() || null,
      ...(releaseChanged ? { discogs_synced_at: null } : {}),
    }
    const { error } = record
      ? await supabase.from('vinyl_records').update(databaseValues).eq('id', record.id)
      : await supabase.from('vinyl_records').insert([{ ...databaseValues, collection_owner: owner }])

    if (error) {
      console.error('Failed to insert record:', error.message)
      alert(`${t.databaseError} ${error.message}`)
      return
    }

    if (onSaveAndNext) {
      onSaveAndNext(valuesToSave, addToDiscogsCollection)
      return
    }

    onSuccess?.(valuesToSave)
  }

  async function handleUpdateExisting() {
    if (!duplicateRecord || !pendingFormValues) return

    const databaseValues = {
      ...pendingFormValues,
      record_type: pendingFormValues.record_type || null,
      record_size: pendingFormValues.record_size || null,
      catalog_number: pendingFormValues.catalog_number || null,
      media_condition: pendingFormValues.media_condition || null,
      sleeve_condition: pendingFormValues.sleeve_condition || null,
      marketplace_price: pendingFormValues.marketplace_price ?? null,
      marketplace_currency: pendingFormValues.marketplace_currency || null,
      hero_tagline: pendingFormValues.hero_tagline?.trim() || null,
    }

    const { error } = await supabase
      .from('vinyl_records')
      .update(databaseValues)
      .eq('id', duplicateRecord.id)

    if (error) {
      console.error('Failed to update record:', error.message)
      alert(`${t.databaseError} ${error.message}`)
      return
    }

    setDuplicateRecord(null)
    setPendingFormValues(null)
    onSuccess?.(pendingFormValues)
  }

  async function handleCreateDuplicate() {
    if (!pendingFormValues) return
    setDuplicateRecord(null)
    setPendingFormValues(null)
    await proceedWithSave(pendingFormValues)
  }

  async function handleDiscogsSearch(useFilters = false) {
    const artist = form.getValues('artist').trim()
    const title = form.getValues('title').trim()
    const releaseUrl = manualDiscogsSearch === 'url' ? discogsUrlInput.trim() : ''
    const catalogNumber = manualDiscogsSearch === 'catalogNumber' ? catalogNumberInput.trim() : ''
    setDiscogsResults([])
    setDiscogsSearchError(null)
    setDiscogsHasSearched(false)
    setSelectedDiscogsTitle(null)
    setSelectedDiscogsRelease(null)
    setAppliedDiscogsFields(new Set())

    if (!useFilters) {
      setDiscogsCountryFilter('all')
      setDiscogsYearFilter('all')
    }

    if (manualDiscogsSearch === 'catalogNumber') {
      if (!/[\p{L}\p{N}]/u.test(catalogNumber)) {
        setDiscogsSearchError(translations[language].app.catalogNumberInvalid)
        return
      }
      setDiscogsSearching(true)
      try {
        setDiscogsResults(await searchDiscogsByCatalogNumber(catalogNumber))
        setDiscogsHasSearched(true)
      } catch (error) {
        setDiscogsSearchError(error instanceof Error ? error.message : t.discogsSearchError)
      } finally {
        setDiscogsSearching(false)
      }
      return
    }

    if (!artist && !title && !releaseUrl) {
      setDiscogsSearchError(t.discogsSearchRequired)
      return
    }

    setDiscogsSearching(true)
    try {
      const filters = useFilters && !releaseUrl
        ? {
            country: discogsCountryFilter === 'all' ? undefined : discogsCountryFilter,
            year: discogsYearFilter === 'all' ? undefined : Number(discogsYearFilter),
          }
        : undefined
      setDiscogsResults(await searchDiscogsReleases(artist, title, releaseUrl || undefined, filters))
      setDiscogsHasSearched(true)
    } catch (error) {
      setDiscogsSearchError(error instanceof Error ? error.message : t.discogsSearchError)
    } finally {
      setDiscogsSearching(false)
    }
  }

  // When opened after a failed auto-fill, search Discogs suggestions right away.
  const autoSearchTriggered = useRef(false)
  useEffect(() => {
    if (!autoSearchDiscogs || autoSearchTriggered.current) return
    autoSearchTriggered.current = true
    void handleDiscogsSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearchDiscogs])

  const watchedArtist = form.watch('artist')
  const watchedTitle = form.watch('title')
  const watchedIsHero = form.watch('is_hero')
  const watchedMarketplacePrice = form.watch('marketplace_price')
  // Mirrors the public_catalog filter; only drives a non-blocking warning.
  const heroHiddenFromStore = form.watch('sold')
    || !form.watch('sell_possibility')
    || ((watchedMarketplacePrice === undefined || watchedMarketplacePrice === null || watchedMarketplacePrice === '') && record?.price_on_discogs == null)
  // Only show a duplicate while both artist and title are filled in.
  const existingDuplicate = watchedArtist.trim() && watchedTitle.trim() ? foundDuplicate : null

  useEffect(() => {
    const artist = watchedArtist.trim()
    const title = watchedTitle.trim()

    if (duplicateCheckTimeoutRef.current) {
      clearTimeout(duplicateCheckTimeoutRef.current)
    }

    if (artist && title) {
      duplicateCheckTimeoutRef.current = setTimeout(async () => {
        try {
          const duplicate = await checkDuplicateRecord(artist, title, owner)
          setFoundDuplicate((current) => {
            if (current?.id !== duplicate?.id) setDuplicateAcknowledged(false)
            return duplicate
          })
        } catch {
          setFoundDuplicate(null)
        }
      }, 500)
    }

    return () => {
      if (duplicateCheckTimeoutRef.current) {
        clearTimeout(duplicateCheckTimeoutRef.current)
      }
    }
  }, [watchedArtist, watchedTitle, owner])

  async function selectDiscogsRelease(release: DiscogsRelease) {
    setSelectedDiscogsTitle(release.title)
    setSelectedDiscogsRelease({ ...release, lowestPrice: null, priceCurrency: 'USD' })
    setAppliedDiscogsFields(new Set())
    setDiscogsResults([])
    setDiscogsPriceLookupComplete(false)
    setDiscogsPriceLoading(true)
    try {
      const priceStats = await getDiscogsLowestPrice(release.id)
        form.setValue('discogs_lowest_price', priceStats.lowestPrice ?? undefined, { 
        shouldDirty: true,
        shouldValidate: true,
      })
      setSelectedDiscogsRelease((current) => current?.id === release.id
        ? { ...current, ...priceStats }
        : current,
      )
      setDiscogsPriceLookupComplete(true)
    } catch {
      setDiscogsPriceLookupComplete(false)
    } finally {
      setDiscogsPriceLoading(false)
    }
  }

  const discogsProposals = selectedDiscogsRelease ? [
    {
      key: 'artist',
      label: t.artist.replace(' *', ''),
      currentValue: form.getValues('artist'),
      suggestedValue: selectedDiscogsRelease.artist,
      apply: () => form.setValue('artist', selectedDiscogsRelease.artist, { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'title',
      label: t.albumTitle.replace(' *', ''),
      currentValue: form.getValues('title'),
      suggestedValue: selectedDiscogsRelease.releaseTitle,
      apply: () => form.setValue('title', selectedDiscogsRelease.releaseTitle, { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'year_pressed',
      label: t.yearPressed,
      currentValue: form.getValues('year_pressed'),
      suggestedValue: selectedDiscogsRelease.year,
      apply: () => form.setValue('year_pressed', selectedDiscogsRelease.year ?? undefined, { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'country_pressed',
      label: t.country,
      currentValue: form.getValues('country_pressed'),
      suggestedValue: selectedDiscogsRelease.country,
      apply: () => form.setValue('country_pressed', selectedDiscogsRelease.country ?? '', { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'catalog_number',
      label: 'Cat#',
      currentValue: form.getValues('catalog_number'),
      suggestedValue: selectedDiscogsRelease.catalogNumber,
      apply: () => form.setValue('catalog_number', selectedDiscogsRelease.catalogNumber ?? '', { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'record_label',
      label: t.recordLabel,
      currentValue: form.getValues('record_label'),
      suggestedValue: selectedDiscogsRelease.label[0],
      apply: () => form.setValue('record_label', selectedDiscogsRelease.label[0] ?? '', { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'record_type',
      label: t.type,
      currentValue: form.getValues('record_type'),
      suggestedValue: selectedDiscogsRelease.recordType,
      apply: () => form.setValue('record_type', selectedDiscogsRelease.recordType ?? '', { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'record_size',
      label: t.size,
      currentValue: form.getValues('record_size'),
      suggestedValue: selectedDiscogsRelease.recordSize,
      apply: () => form.setValue('record_size', selectedDiscogsRelease.recordSize ?? '', { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'genre',
      label: t.genre,
      currentValue: form.getValues('genre'),
      suggestedValue: selectedDiscogsRelease.genre,
      apply: () => form.setValue('genre', selectedDiscogsRelease.genre ?? '', { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'sub_genre',
      label: t.subGenre,
      currentValue: form.getValues('sub_genre'),
      suggestedValue: selectedDiscogsRelease.subGenre,
      apply: () => form.setValue('sub_genre', selectedDiscogsRelease.subGenre ?? '', { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'image_url',
      label: t.coverImageUrl,
      currentValue: form.getValues('image_url'),
      suggestedValue: selectedDiscogsRelease.coverImage,
      apply: () => form.setValue('image_url', selectedDiscogsRelease.coverImage, { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'discogs_link',
      label: t.discogsUrl,
      currentValue: form.getValues('discogs_link'),
      suggestedValue: selectedDiscogsRelease.url,
      apply: () => form.setValue('discogs_link', selectedDiscogsRelease.url, { shouldDirty: true, shouldValidate: true }),
    },
    {
      key: 'discogs_lowest_price',
      label: t.discogsLowestPrice,
      currentValue: form.getValues('discogs_lowest_price'),
      suggestedValue: selectedDiscogsRelease.lowestPrice,
      apply: () => form.setValue('discogs_lowest_price', selectedDiscogsRelease.lowestPrice ?? undefined, { shouldDirty: true, shouldValidate: true }),
    },
  ].filter((proposal) => {
    if (appliedDiscogsFields.has(proposal.key) || proposal.suggestedValue === undefined || (proposal.suggestedValue === null && (proposal.key !== 'discogs_lowest_price' || !discogsPriceLookupComplete)) || proposal.suggestedValue === '') {
      return false
    }
    return String(proposal.currentValue ?? '').trim() !== String(proposal.suggestedValue).trim()
    return String(proposal.currentValue ?? '').trim() !== String(proposal.suggestedValue ?? '').trim()
  }) : []

  function displayProposalValue(value: unknown) {
    return value === null || value === undefined || value === '' ? '-' : String(value)
  }

  function displayDiscogsPrice(value: unknown) {
    if (value === null || value === undefined || value === '') return '-'
    return new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Number(value))
  }

  const discogsCountries = [...new Set(discogsResults.map((release) => release.country).filter((country): country is string => Boolean(country)))]
    .sort((left, right) => countryRank(left) - countryRank(right) || left.localeCompare(right))
  const discogsYears = [...new Set(discogsResults.map((release) => release.year).filter((year): year is number => year !== null))]
    .sort((left, right) => right - left)
  // Pressing-country priority: Canada, Brazil, US, Europe, others (see countryRank).
  // Catalog-number results keep match quality (exact first, then closest) ahead of the country.
  const filteredDiscogsResults = discogsResults
    .filter((release) =>
      (discogsCountryFilter === 'all' || release.country === discogsCountryFilter)
      && (discogsYearFilter === 'all' || String(release.year) === discogsYearFilter),
    )
    .sort((left, right) =>
      (left.matchTier ?? 0) - (right.matchTier ?? 0)
      || (left.matchDistance ?? 0) - (right.matchDistance ?? 0)
      || countryRank(left.country) - countryRank(right.country))
  const hasDiscogsFilters = discogsCountryFilter !== 'all' || discogsYearFilter !== 'all'

  return (
    <>
      <Dialog open={existingDuplicate !== null && !record && !duplicateAcknowledged} onOpenChange={(open) => {
        if (!open) setDuplicateAcknowledged(true)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" aria-hidden="true" />
              {t.similarRecordExists}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {existingDuplicate?.artist} – {existingDuplicate?.title}
              {existingDuplicate?.year_pressed && ` (${existingDuplicate.year_pressed}`}
              {existingDuplicate?.country_pressed && `, ${existingDuplicate.country_pressed}`}
              {existingDuplicate?.year_pressed && ')'}
            </p>
            {existingDuplicate?.catalog_number && <p className="font-mono text-sm font-semibold">Cat# {existingDuplicate.catalog_number}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={skipRecord}>
              {t.skipRecord}
            </Button>
            <Button type="button" onClick={() => setDuplicateAcknowledged(true)}>
              {t.continueAnyway}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {showTopSaveButton && (
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {record ? t.saveChanges : t.save}
          </Button>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {onUploadPicture && (
            <Button type="button" variant="default" onClick={onUploadPicture}>
              <Images aria-hidden="true" />
              {translations[language].app.upload}
            </Button>
          )}
          {manualDiscogsSearch === 'url' ? (
            <div id="discogs-url-field" className="min-w-0 flex-1">
              <div className="space-y-2">
                <Label htmlFor="discogs-url-input">{t.discogsUrl}</Label>
                <Input
                  id="discogs-url-input"
                  type="url"
                  value={discogsUrlInput}
                  onChange={(event) => setDiscogsUrlInput(event.target.value)}
                  placeholder="https://www.discogs.com/release/..."
                />
              </div>
            </div>
          ) : manualDiscogsSearch === 'catalogNumber' ? (
            <div id="discogs-catno-field" className="min-w-0 flex-1">
              <div className="space-y-2">
                <Label htmlFor="discogs-catno-input">{translations[language].app.catalogNumberLabel}</Label>
                <Input
                  id="discogs-catno-input"
                  autoFocus
                  autoComplete="off"
                  className="font-mono"
                  value={catalogNumberInput}
                  onChange={(event) => setCatalogNumberInput(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter searches Discogs instead of submitting (saving) the record form.
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleDiscogsSearch()
                    }
                  }}
                  placeholder={translations[language].app.catalogNumberPlaceholder}
                />
              </div>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                aria-expanded={false}
                aria-controls="discogs-url-field"
                onClick={() => setManualDiscogsSearch('url')}
              >
                {t.manualDiscogsUrl}
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-expanded={false}
                aria-controls="discogs-catno-field"
                onClick={() => setManualDiscogsSearch('catalogNumber')}
              >
                <Hash aria-hidden="true" />
                {t.searchByCatalogNumber}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-black bg-black text-white hover:bg-black/90 hover:text-white"
            onClick={() => void handleDiscogsSearch()}
            disabled={discogsSearching}
          >
            {discogsSearching ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Search aria-hidden="true" />
            )}
            {discogsSearching
              ? t.searchingDiscogs
              : manualDiscogsSearch
                ? t.searchDiscogsByUrl
                : t.searchDiscogs}
          </Button>
          {manualDiscogsSearch && (
            <Button type="button" variant="ghost" onClick={() => setManualDiscogsSearch(null)}>
              {manualDiscogsSearch === 'url' ? t.hideDiscogsUrl : t.hideCatalogNumber}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="artist" render={({ field }) => (
            <FormItem><FormLabel>{t.artist}</FormLabel><FormControl><Input placeholder={t.artistPlaceholder} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="title" render={({ field }) => (
            <FormItem><FormLabel>{t.albumTitle}</FormLabel><FormControl><Input placeholder={t.albumTitlePlaceholder} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField control={form.control} name="record_label" render={({ field }) => (
            <FormItem><FormLabel>{t.recordLabel}</FormLabel><FormControl><Input placeholder={t.recordLabelPlaceholder} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="genre" render={({ field }) => (
            <FormItem><FormLabel>{t.genre}</FormLabel><FormControl><Input placeholder={t.genrePlaceholder} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="sub_genre" render={({ field }) => (
            <FormItem><FormLabel>{t.subGenre}</FormLabel><FormControl><Input placeholder={t.subGenrePlaceholder} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="space-y-3">
          {selectedDiscogsTitle && (
            <p className="text-sm text-muted-foreground">
              {t.discogsReleaseSelected} {selectedDiscogsTitle}
            </p>
          )}
          {discogsSearchError && (
            <p role="alert" className="text-sm text-destructive">
              {discogsSearchError}
            </p>
          )}
          {discogsHasSearched && discogsResults.length === 0 && !discogsSearchError && (
            <p className="text-sm text-muted-foreground">{t.noDiscogsMatches}</p>
          )}
          {discogsResults.length > 1 && (
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Label htmlFor="discogs-country-filter">{t.filterCountry}</Label>
                <Select value={discogsCountryFilter} onValueChange={setDiscogsCountryFilter}>
                  <SelectTrigger id="discogs-country-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.allCountries}</SelectItem>
                    {discogsCountries.map((country) => (
                      <SelectItem key={country} value={country}>{country}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="discogs-year-filter">{t.filterYear}</Label>
                <Select value={discogsYearFilter} onValueChange={setDiscogsYearFilter}>
                  <SelectTrigger id="discogs-year-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.allYears}</SelectItem>
                    {discogsYears.map((year) => (
                      <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {hasDiscogsFilters && manualDiscogsSearch !== 'catalogNumber' && !(manualDiscogsSearch === 'url' && discogsUrlInput.trim()) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleDiscogsSearch(true)}
                  disabled={discogsSearching}
                >
                  {discogsSearching ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
                  {t.searchDiscogsWithFilters}
                </Button>
              )}
            </div>
          )}
          {discogsResults.length > 0 && filteredDiscogsResults.length === 0 && (
            <p className="text-sm text-muted-foreground">{t.noFilteredDiscogsMatches}</p>
          )}
          {filteredDiscogsResults.length > 0 && (
            <section aria-label={t.discogsMatches} className="space-y-2">
              <h3 className="text-sm font-medium">{t.discogsMatches}</h3>
              <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                {filteredDiscogsResults.map((release) => (
                  <button
                    key={release.id}
                    type="button"
                    className="flex min-w-0 items-center gap-3 rounded-md border p-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`${t.selectDiscogsRelease}: ${release.title}`}
                    onClick={() => selectDiscogsRelease(release)}
                  >
                    <img
                      src={release.thumbnail}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-sm object-cover"
                      loading="lazy"
                    />
                    <span className="min-w-0">
                      <span className="block line-clamp-2 text-sm font-medium">{release.title}</span>
                      {release.catalogNumber && <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">{release.catalogNumber}</span>}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {[release.year, release.country, release.format.join(', '), release.label[0]]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Disc3 className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FormField control={form.control} name="record_type" render={({ field }) => (
            <FormItem>
              <FormLabel>{t.type}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder={t.select} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="LP">LP</SelectItem>
                  <SelectItem value="EP">EP</SelectItem>
                  <SelectItem value="Single">{t.single}</SelectItem>
                  <SelectItem value="Box Set">{t.boxSet}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="record_size" render={({ field }) => (
            <FormItem>
              <FormLabel>{t.size}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder={t.select} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="12&quot;">12"</SelectItem>
                  <SelectItem value="10&quot;">10"</SelectItem>
                  <SelectItem value="7&quot;">7"</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="year_pressed" render={({ field }) => (
            <FormItem><FormLabel>{t.yearPressed}</FormLabel><FormControl><Input type="number" placeholder={t.yearPlaceholder} {...field} value={field.value ? String(field.value) : ''} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="country_pressed" render={({ field }) => (
            <FormItem><FormLabel>{t.country}</FormLabel><FormControl><Input placeholder={t.countryPlaceholder} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="catalog_number" render={({ field }) => (
            <FormItem><FormLabel>Cat#</FormLabel><FormControl><Input placeholder="SMAS-3375" className="font-mono" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="media_condition" render={({ field }) => (
            <FormItem>
              <FormLabel>{t.mediaCondition}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder={t.select} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="M">{t.mint}</SelectItem>
                  <SelectItem value="NM">{t.nearMint}</SelectItem>
                  <SelectItem value="VG+">{t.veryGoodPlus}</SelectItem>
                  <SelectItem value="VG">{t.veryGood}</SelectItem>
                  <SelectItem value="G+">{t.goodPlus}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="sleeve_condition" render={({ field }) => (
            <FormItem>
              <FormLabel>{t.sleeveCondition}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder={t.select} /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="M">{t.mint}</SelectItem>
                  <SelectItem value="NM">{t.nearMint}</SelectItem>
                  <SelectItem value="VG+">{t.veryGoodPlus}</SelectItem>
                  <SelectItem value="VG">{t.veryGood}</SelectItem>
                  <SelectItem value="G+">{t.goodPlus}</SelectItem>
                  <SelectItem value="Generic">{t.generic}</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="image_url" render={({ field }) => (
            <FormItem><FormLabel>{t.coverImageUrl}</FormLabel><FormControl><Input placeholder="https://..." {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="source_url" render={({ field }) => (
            <FormItem><FormLabel>{t.facebookMarketplaceLink}</FormLabel><FormControl><Input type="url" placeholder="https://www.facebook.com/marketplace/item/..." {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <FormField control={form.control} name="marketplace_price" render={({ field }) => (
            <FormItem>
              <FormLabel>{t.marketplacePrice}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={field.value === undefined || field.value === null ? '' : String(field.value)}
                  onChange={(event) => field.onChange(event.target.value)}
                  placeholder="0.00"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="marketplace_currency" render={({ field }) => (
            <FormItem>
              <FormLabel>{t.marketplaceCurrency}</FormLabel>
              <FormControl>
                <Input
                  maxLength={3}
                  value={field.value ?? ''}
                  onChange={(event) => field.onChange(event.target.value.toUpperCase().slice(0, 3))}
                  placeholder="CAD"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 py-2">
          <FormField control={form.control} name="is_original" render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-2 space-y-0">
              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              <FormLabel className="cursor-pointer font-normal">{t.originalPressing}</FormLabel>
            </FormItem>
          )} />
          <FormField control={form.control} name="is_special_edition" render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-2 space-y-0">
              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              <FormLabel className="cursor-pointer font-normal">{t.specialEdition}</FormLabel>
            </FormItem>
          )} />
          <FormField control={form.control} name="sell_possibility" render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-2 space-y-0">
              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              <FormLabel className="cursor-pointer font-normal text-destructive">{t.willingToSell}</FormLabel>
            </FormItem>
          )} />
          <FormField control={form.control} name="sold" render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-2 space-y-0">
              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              <FormLabel className="cursor-pointer font-normal">{t.sold}</FormLabel>
            </FormItem>
          )} />
          <FormField control={form.control} name="is_hero" render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-2 space-y-0">
              <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              <FormLabel className="cursor-pointer font-normal">{t.featureOnHero}</FormLabel>
            </FormItem>
          )} />
        </div>

        {watchedIsHero && (
          <div className="space-y-2">
            <FormField control={form.control} name="hero_tagline" render={({ field }) => (
              <FormItem>
                <FormLabel>{t.heroTagline}</FormLabel>
                <FormControl><Input maxLength={90} placeholder={t.heroTaglinePlaceholder} {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {heroHiddenFromStore && (
              <p role="status" className="text-sm text-amber-600">{t.heroHiddenWarning}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField control={form.control} name="special_edition_reason" render={({ field }) => (
            <FormItem><FormLabel>{t.specialReason}</FormLabel><FormControl><Textarea placeholder={t.specialReasonPlaceholder} className="resize-none" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="notes" render={({ field }) => (
            <FormItem><FormLabel>{t.notes}</FormLabel><FormControl><Textarea placeholder={t.notesPlaceholder} className="resize-none" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        {onSaveAndNext && (
          <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-medium text-destructive">
            <Checkbox
              checked={addToDiscogsCollection}
              onCheckedChange={(checked) => setAddToDiscogsCollection(checked === true)}
              className="border-destructive data-[state=checked]:bg-destructive data-[state=checked]:text-destructive-foreground"
            />
            {t.addToDiscogsCollection}
          </label>
        )}

        <Button type="submit" className="mt-4 w-full" disabled={form.formState.isSubmitting}>
          {record ? (onSaveAndNext ? t.saveAndNext : t.saveChanges) : t.save}
        </Button>
      </form>
      <Dialog
        open={selectedDiscogsRelease !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDiscogsRelease(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.reviewDiscogsRelease}</DialogTitle>
            <DialogDescription>{selectedDiscogsRelease?.title}</DialogDescription>
          </DialogHeader>
          {discogsPriceLoading && (
            <p className="text-sm text-muted-foreground">{t.fetchingDiscogsPrice}</p>
          )}
          {!discogsPriceLoading && selectedDiscogsRelease?.lowestPrice !== null && selectedDiscogsRelease?.lowestPrice !== undefined && (
            <p className="text-sm text-muted-foreground">
              {t.discogsLowestPrice}: {displayDiscogsPrice(selectedDiscogsRelease.lowestPrice)}
            </p>
          )}
          {!discogsPriceLoading && discogsPriceLookupComplete && selectedDiscogsRelease?.lowestPrice === null && (
            <p className="text-sm text-muted-foreground">{t.noDiscogsPrice}</p>
          )}
          {discogsProposals.length ? (
            <div className="divide-y">
              {discogsProposals.map((proposal) => (
                <div key={proposal.key} className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{proposal.label} · {t.currentValue}</p>
                    {proposal.key === 'image_url' ? (
                      proposal.currentValue ? (
                        <img src={String(proposal.currentValue)} alt={t.currentValue} className="mt-1 h-14 w-14 rounded-sm object-cover" />
                      ) : <p className="mt-1 text-sm">-</p>
                    ) : proposal.key === 'discogs_lowest_price' ? (
                      <p className="break-words text-sm">{displayDiscogsPrice(proposal.currentValue)}</p>
                    ) : (
                      <p className="break-words text-sm">{displayProposalValue(proposal.currentValue)}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={`${t.applyDiscogsField}: ${proposal.label}`}
                    title={`${t.applyDiscogsField}: ${proposal.label}`}
                    onClick={() => {
                      proposal.apply()
                      setAppliedDiscogsFields((current) => new Set(current).add(proposal.key))
                    }}
                  >
                    <ArrowRight aria-hidden="true" />
                  </Button>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{proposal.label} · {t.discogsSuggestion}</p>
                    {proposal.key === 'image_url' ? (
                      <img src={String(proposal.suggestedValue)} alt={t.discogsSuggestion} className="mt-1 h-14 w-14 rounded-sm object-cover" />
                    ) : proposal.key === 'discogs_lowest_price' ? (
                      <p className="break-words text-sm">{displayDiscogsPrice(proposal.suggestedValue)}</p>
                    ) : (
                      <p className="break-words text-sm">{displayProposalValue(proposal.suggestedValue)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">{t.noDiscogsDifferences}</p>
          )}
          <DialogFooter>
            {discogsProposals.length > 0 && (
              <Button
                type="button"
                onClick={() => {
                  const proposals = [...discogsProposals]
                  proposals.forEach((proposal) => proposal.apply())
                  setAppliedDiscogsFields((current) => new Set([
                    ...current,
                    ...proposals.map((proposal) => proposal.key),
                  ]))
                }}
              >
                {t.applyAllDiscogs}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setSelectedDiscogsRelease(null)}>{t.closeReview}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={duplicateRecord !== null} onOpenChange={(open) => {
        if (!open) {
          setDuplicateRecord(null)
          setPendingFormValues(null)
        }
      }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" aria-hidden="true" />
              {t.duplicateRecordFound}
            </DialogTitle>
            <DialogDescription>
              {t.duplicateRecordDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{t.duplicateRecordNew}</h3>
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.artist.replace(' *', '')}</p>
                  <p className="text-sm font-medium">{pendingFormValues?.artist || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.albumTitle.replace(' *', '')}</p>
                  <p className="text-sm font-medium">{pendingFormValues?.title || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Cat#</p>
                  <p className="font-mono text-sm font-semibold">{pendingFormValues?.catalog_number || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.yearPressed}</p>
                  <p className="text-sm">{pendingFormValues?.year_pressed || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.country}</p>
                  <p className="text-sm">{pendingFormValues?.country_pressed || '-'}</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-4 dark:border-amber-900/30 dark:bg-amber-950/20">
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{t.duplicateRecordExisting}</h3>
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.artist.replace(' *', '')}</p>
                  <p className="text-sm font-medium">{duplicateRecord?.artist || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.albumTitle.replace(' *', '')}</p>
                  <p className="text-sm font-medium">{duplicateRecord?.title || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Cat#</p>
                  <p className="font-mono text-sm font-semibold">{duplicateRecord?.catalog_number || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.yearPressed}</p>
                  <p className="text-sm">{duplicateRecord?.year_pressed || '-'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t.country}</p>
                  <p className="text-sm">{duplicateRecord?.country_pressed || '-'}</p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDuplicateRecord(null)
                setPendingFormValues(null)
              }}
            >
              {translations[language].table.cancel}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCreateDuplicate}
              disabled={isCheckingDuplicate}
            >
              {t.duplicateRecordCreateDuplicate}
            </Button>
            <Button
              type="button"
              onClick={handleUpdateExisting}
              disabled={isCheckingDuplicate}
            >
              {t.duplicateRecordUpdate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
    </>
  )
}
