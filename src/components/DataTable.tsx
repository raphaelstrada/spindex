import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleDollarSign,
  Disc3,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { RecordForm } from '@/components/RecordForm'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { supabase } from '@/lib/supabase'
import { getCollectionOwner } from '@/lib/collection'
import { getDiscogsLowestPrice, getDiscogsReleaseId, searchDiscogsReleases, syncRecordsToDiscogs, type DiscogsSyncResult } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'
import type { VinylRecord } from '@/lib/record'

const visibleRecordFields = new Set([
  'image_url', 'original_image_url', 'artist', 'title', 'year_pressed', 'genre',
  'discogs_lowest_price', 'marketplace_price', 'marketplace_currency',
])
const recordFilterFields: string[] = [
  'id', 'artist', 'title', 'year_pressed', 'genre', 'image_url', 'original_image_url', 'source_url',
  'record_label', 'sub_genre', 'record_type', 'record_size', 'country_pressed',
  'media_condition', 'sleeve_condition', 'is_original', 'is_special_edition',
  'special_edition_reason', 'sell_possibility', 'sold', 'discogs_lowest_price', 'marketplace_price', 'marketplace_currency',
  'notes', 'discogs_link',
]
const dropdownFilterFields = new Set([
  'artist', 'title', 'year_pressed', 'genre', 'record_label',
  'sub_genre', 'country_pressed', 'media_condition', 'sleeve_condition',
])
const autocompleteFilterFields = new Set(['artist', 'title'])

function searchableValue(value: unknown, language: Language) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? translations[language].table.yes : translations[language].table.no
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function matchesGlobalSearch(record: VinylRecord, query: string, language: Language) {
  return Object.entries(record).some(([field, value]) =>
    field !== 'collection_owner'
    && searchableValue(value, language).toLocaleLowerCase().includes(query),
  )
}

function hasNoDiscogsPrice(record: VinylRecord) {
  return record.discogs_lowest_price === null || record.discogs_lowest_price === undefined
}

function formatMarketplacePrice(price: number, currency: string | null | undefined, language: Language) {
  const locale = language === 'pt' ? 'pt-BR' : 'en-US'
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price)
  if (!currency) return number

  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(price)
  } catch {
    return `${currency} ${number}`
  }
}

export function DataTable({ language, recordsVersion }: { language: Language; recordsVersion: number }) {
  const [data, setData] = useState<VinylRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'artist', desc: false }])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const [globalSearch, setGlobalSearch] = useState('')
  const [advancedFilters, setAdvancedFilters] = useState<Record<string, string>>({})
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 100 })
  const [previewingRecord, setPreviewingRecord] = useState<VinylRecord | null>(null)
  const [editingRecord, setEditingRecord] = useState<VinylRecord | null>(null)
  const [editAutoSearch, setEditAutoSearch] = useState(false)
  const [deletingRecord, setDeletingRecord] = useState<VinylRecord | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [pendingPriceId, setPendingPriceId] = useState<string | null>(null)
  const [selectedPriceIds, setSelectedPriceIds] = useState<Set<string>>(new Set())
  const [selectedSyncIds, setSelectedSyncIds] = useState<Set<string>>(new Set())
  const [isSyncLoading, setIsSyncLoading] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null)
  const [syncSummary, setSyncSummary] = useState<string | null>(null)
  const [syncDetails, setSyncDetails] = useState<{ record: VinylRecord; status: string; detail?: string }[] | null>(null)
  const [isBatchPriceLoading, setIsBatchPriceLoading] = useState(false)
  const [batchPriceProgress, setBatchPriceProgress] = useState<{ current: number; total: number } | null>(null)
  const [batchPriceSummary, setBatchPriceSummary] = useState<string | null>(null)
  const t = translations[language].table
  const filterUiText = language === 'pt'
    ? { selectValue: translations.pt.table.selectFilterValue, clearSelection: translations.pt.table.clearFilterSelection, resetAll: translations.pt.table.resetAll }
    : { selectValue: translations.en.table.selectFilterValue, clearSelection: translations.en.table.clearFilterSelection, resetAll: translations.en.table.resetAll }
  const priceUiText = language === 'pt'
    ? {
        selectAllUnpriced: translations.pt.table.selectAllUnpriced,
        selectUnpricedRecord: translations.pt.table.selectUnpricedRecord,
        recordsSelected: translations.pt.table.recordsSelected,
        autoFillSelectedPrices: translations.pt.table.autoFillSelectedPrices,
        clearPriceSelection: translations.pt.table.clearPriceSelection,
        batchPriceSummary: translations.pt.table.batchPriceSummary,
      }
    : {
        selectAllUnpriced: translations.en.table.selectAllUnpriced,
        selectUnpricedRecord: translations.en.table.selectUnpricedRecord,
        recordsSelected: translations.en.table.recordsSelected,
        autoFillSelectedPrices: translations.en.table.autoFillSelectedPrices,
        clearPriceSelection: translations.en.table.clearPriceSelection,
        batchPriceSummary: translations.en.table.batchPriceSummary,
      }
  const syncUiText = language === 'pt'
    ? {
        selectAllForSync: translations.pt.table.selectAllForSync,
        selectRecordForSync: translations.pt.table.selectRecordForSync,
        recordsSelectedForSync: translations.pt.table.recordsSelectedForSync,
        discogsSyncSelected: translations.pt.table.discogsSyncSelected,
        clearSyncSelection: translations.pt.table.clearSyncSelection,
        syncingWithDiscogs: translations.pt.table.syncingWithDiscogs,
        discogsTokenPrompt: translations.pt.table.discogsTokenPrompt,
        discogsTokenInvalid: translations.pt.table.discogsTokenInvalid,
        noReleaseForSync: translations.pt.table.noReleaseForSync,
        syncSummary: translations.pt.table.syncSummary,
        removeFromDiscogs: translations.pt.table.removeFromDiscogs,
        removingFromDiscogs: translations.pt.table.removingFromDiscogs,
        confirmRemoveFromDiscogs: translations.pt.table.confirmRemoveFromDiscogs,
        removeSummary: translations.pt.table.removeSummary,
        syncingProgress: translations.pt.table.syncingProgress,
        syncResultsTitle: translations.pt.table.syncResultsTitle,
      }
    : {
        selectAllForSync: translations.en.table.selectAllForSync,
        selectRecordForSync: translations.en.table.selectRecordForSync,
        recordsSelectedForSync: translations.en.table.recordsSelectedForSync,
        discogsSyncSelected: translations.en.table.discogsSyncSelected,
        clearSyncSelection: translations.en.table.clearSyncSelection,
        syncingWithDiscogs: translations.en.table.syncingWithDiscogs,
        discogsTokenPrompt: translations.en.table.discogsTokenPrompt,
        discogsTokenInvalid: translations.en.table.discogsTokenInvalid,
        noReleaseForSync: translations.en.table.noReleaseForSync,
        syncSummary: translations.en.table.syncSummary,
        removeFromDiscogs: translations.en.table.removeFromDiscogs,
        removingFromDiscogs: translations.en.table.removingFromDiscogs,
        confirmRemoveFromDiscogs: translations.en.table.confirmRemoveFromDiscogs,
        removeSummary: translations.en.table.removeSummary,
        syncingProgress: translations.en.table.syncingProgress,
        syncResultsTitle: translations.en.table.syncResultsTitle,
      }

  useEffect(() => {
    async function fetchRecords() {
      setIsLoading(true)
      setErrorMsg(null)

      const pageSize = 1000
      const allRecords: VinylRecord[] = []
      let from = 0

      try {
        // Supabase/PostgREST caps responses at 1000 rows, so paginate to fetch everything.
        for (;;) {
          const { data: records, error } = await supabase
            .from('vinyl_records')
            .select('*')
            .ilike('collection_owner', getCollectionOwner())
            .order('artist', { ascending: true })
            .order('id', { ascending: true })
            .range(from, from + pageSize - 1)

          if (error) {
            console.error('Supabase fetch error:', error)
            setErrorMsg(error.message)
            break
          }

          allRecords.push(...((records || []) as VinylRecord[]))

          if (!records || records.length < pageSize) break
          from += pageSize
        }

        if (allRecords.length > 0) setData(allRecords)
      } finally {
        setIsLoading(false)
      }
    }
    fetchRecords()
  }, [recordsVersion])

  async function toggleSold(record: VinylRecord) {
    const sold = !record.sold
    setPendingActionId(record.id)
    const { error } = await supabase
      .from('vinyl_records')
      .update({ sold })
      .eq('id', record.id)

    if (error) {
      alert(`${t.updateFailed} ${error.message}`)
    } else {
      setData((current) => current.map((item) =>
        item.id === record.id ? { ...item, sold } : item,
      ))
    }
    setPendingActionId(null)
  }

  async function confirmDelete() {
    if (!deletingRecord) return

    setPendingActionId(deletingRecord.id)
    const { error } = await supabase
      .from('vinyl_records')
      .delete()
      .eq('id', deletingRecord.id)

    if (error) {
      alert(`${t.deleteFailed} ${error.message}`)
    } else {
      setData((current) => current.filter((item) => item.id !== deletingRecord.id))
      setDeletingRecord(null)
    }
    setPendingActionId(null)
  }

  async function updateDiscogsPrice(record: VinylRecord): Promise<'updated' | 'no-release' | 'no-price'> {
    let releaseId = getDiscogsReleaseId(record.discogs_link)
      ?? getDiscogsReleaseId(record.image_url)

    if (!releaseId && record.artist && record.title) {
      const normalize = (value: string) => value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\band\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
      const releases = await searchDiscogsReleases(record.artist, record.title, undefined, {
        year: record.year_pressed ?? undefined,
      })
      const exactMatches = releases.filter((release) =>
        normalize(release.artist) === normalize(record.artist ?? '')
        && normalize(release.releaseTitle) === normalize(record.title ?? ''),
      )

      const score = (release: typeof exactMatches[number]) =>
        Number(record.year_pressed !== null && release.year === record.year_pressed) * 2
        + Number(Boolean(record.country_pressed && release.country === record.country_pressed))
        + Number(Boolean(record.record_label && release.label.some((label) => normalize(label) === normalize(record.record_label ?? ''))))
      const bestScore = Math.max(-1, ...exactMatches.map(score))
      const bestMatches = exactMatches.filter((release) => score(release) === bestScore)

      if (bestMatches.length === 1) releaseId = bestMatches[0].id
    }

    if (!releaseId) return 'no-release'

    const stats = await getDiscogsLowestPrice(releaseId)
    if (stats.lowestPrice === null) return 'no-price'

    const { error } = await supabase
      .from('vinyl_records')
      .update({ discogs_lowest_price: stats.lowestPrice })
      .eq('id', record.id)

    if (error) throw new Error(error.message)

    setData((current) => current.map((item) =>
      item.id === record.id ? { ...item, discogs_lowest_price: stats.lowestPrice } : item,
    ))
    return 'updated'
  }

  async function autoFillDiscogsPrice(record: VinylRecord) {
    setPendingPriceId(record.id)
    try {
      const result = await updateDiscogsPrice(record)
      if (result === 'updated') {
        setSelectedPriceIds((current) => {
          const next = new Set(current)
          next.delete(record.id)
          return next
        })
        return
      }
      // Auto-fill failed: open the edit dialog with Discogs suggestions to pick the right release.
      if (result === 'no-release' || result === 'no-price') {
        setEditAutoSearch(true)
        setEditingRecord(record)
      }
    } catch (error) {
      alert(`${t.updateFailed} ${error instanceof Error ? error.message : ''}`)
    } finally {
      setPendingPriceId(null)
    }
  }

  function displayDetailValue(value: unknown) {
    if (value === null || value === undefined || value === '') return '-'
    if (typeof value === 'boolean') return value ? t.yes : t.no
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const normalizedSearch = globalSearch.trim().toLocaleLowerCase()
  const filteredData = useMemo(() => data.filter((record) => {
    if (normalizedSearch && !matchesGlobalSearch(record, normalizedSearch, language)) return false

    return Object.entries(advancedFilters).every(([field, query]) => {
      if (!query) return true
      const recordValue = searchableValue(record[field], language)
      if (dropdownFilterFields.has(field) && !autocompleteFilterFields.has(field)) return recordValue === query
      return recordValue.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    })
  }), [data, normalizedSearch, advancedFilters, language])
  const unpricedFilteredRecords = filteredData.filter(hasNoDiscogsPrice)
  const selectedFilteredUnpricedCount = unpricedFilteredRecords.filter((record) => selectedPriceIds.has(record.id)).length
  const selectedUnpricedRecords = data.filter((record) => selectedPriceIds.has(record.id) && hasNoDiscogsPrice(record))
  const selectedFilteredSyncCount = filteredData.filter((record) => selectedSyncIds.has(record.id)).length

  const dropdownOptions = useMemo<Record<string, string[]>>(() => {
    const options: Record<string, string[]> = {}

    for (const field of dropdownFilterFields) {
      const matchingRecords = data.filter((record) => {
        if (normalizedSearch && !matchesGlobalSearch(record, normalizedSearch, language)) return false

        const matchesTextFilters = Object.entries(advancedFilters).every(([filterField, query]) => {
          if (!query || dropdownFilterFields.has(filterField)) return true
          return searchableValue(record[filterField], language).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
        })
        if (!matchesTextFilters) return false

        return [...dropdownFilterFields].every((otherField) => {
          if (otherField === field) return true
          const selected = advancedFilters[otherField]
          if (!selected) return true
          const recordValue = searchableValue(record[otherField], language)
          return autocompleteFilterFields.has(otherField)
            ? recordValue.toLocaleLowerCase().includes(selected.trim().toLocaleLowerCase())
            : recordValue === selected
        })
      })

      options[field] = [...new Set(matchingRecords
        .map((record) => record[field])
        .filter((value) => value !== null && value !== undefined && value !== '')
        .map(String))]
        .sort((left, right) => left.localeCompare(right, language === 'pt' ? 'pt-BR' : 'en-US', { numeric: true, sensitivity: 'base' }))
    }

    return options
  }, [data, normalizedSearch, advancedFilters, language])

  function updateAdvancedFilter(field: string, value: string) {
    setAdvancedFilters((current) => ({ ...current, [field]: value }))
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }

  function clearAdvancedFilter(field: string) {
    setAdvancedFilters((current) => {
      const next = { ...current }
      delete next[field]
      return next
    })
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }

  function resetAllFilters() {
    setGlobalSearch('')
    setAdvancedFilters({})
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }

  function toggleAllUnpriced(checked: boolean) {
    setBatchPriceSummary(null)
    setSelectedPriceIds((current) => {
      const next = new Set(current)
      for (const record of unpricedFilteredRecords) {
        if (checked) next.add(record.id)
        else next.delete(record.id)
      }
      return next
    })
  }

  function toggleAllForSync(checked: boolean) {
    setSelectedSyncIds((current) => {
      const next = new Set(current)
      for (const record of filteredData) {
        if (checked) next.add(record.id)
        else next.delete(record.id)
      }
      return next
    })
  }

  async function runDiscogsSync(action: 'add' | 'remove') {
    if (isSyncLoading) return

    const selectedRecords = data.filter((record) => selectedSyncIds.has(record.id))
    const syncableRecords = selectedRecords
      .map((record) => ({ record, releaseId: getDiscogsReleaseId(record.discogs_link) }))
      .filter((entry): entry is { record: VinylRecord; releaseId: number } => entry.releaseId !== null)
    const skippedRecords = selectedRecords.filter((record) => getDiscogsReleaseId(record.discogs_link) === null)

    if (syncableRecords.length === 0) {
      setSyncSummary(syncUiText.noReleaseForSync)
      setSyncDetails(skippedRecords.map((record) => ({
        record,
        status: translations[language].table.syncDetailSkipped,
        detail: undefined,
      })))
      return
    }

    if (action === 'remove') {
      const confirmed = window.confirm(
        syncUiText.confirmRemoveFromDiscogs.replace('{count}', String(syncableRecords.length)),
      )
      if (!confirmed) return
    }

    let token = window.localStorage.getItem('spindex-discogs-token') ?? ''
    if (!token) {
      token = window.prompt(syncUiText.discogsTokenPrompt)?.trim() ?? ''
      if (!token) return
    }

    setIsSyncLoading(true)
    setSyncSummary(null)
    setSyncDetails(null)

    // Process in chunks so large batches show progress and stay within function timeouts.
    const chunkSize = 50
    const chunks: typeof syncableRecords[] = []
    for (let index = 0; index < syncableRecords.length; index += chunkSize) {
      chunks.push(syncableRecords.slice(index, index + chunkSize))
    }

    const recordById = new Map(syncableRecords.map(({ record }) => [record.id, record]))
    const allResults: DiscogsSyncResult[] = []
    const totals = { added: 0, alreadyInCollection: 0, removed: 0, notInCollection: 0, noRelease: 0, failed: 0 }
    let username = ''
    let processed = 0

    try {
      for (const chunk of chunks) {
        const response = await syncRecordsToDiscogs(
          token,
          chunk.map(({ record, releaseId }) => ({ id: record.id, discogsReleaseId: releaseId })),
          action,
        )
        window.localStorage.setItem('spindex-discogs-token', token)
        username = response.username
        allResults.push(...response.results)
        totals.added += response.summary.added
        totals.alreadyInCollection += response.summary.alreadyInCollection
        totals.removed += response.summary.removed
        totals.notInCollection += response.summary.notInCollection
        totals.noRelease += response.summary.noRelease
        totals.failed += response.summary.failed
        processed += chunk.length
        setSyncProgress({ current: processed, total: syncableRecords.length })
      }

      // Apply state changes based on per-record outcomes.
      const syncedAt = new Date().toISOString()
      const addedIds = new Set(allResults
        .filter((result) => result.status === 'added' || result.status === 'already_in_collection')
        .map((result) => result.id))
      const removedIds = new Set(allResults
        .filter((result) => result.status === 'removed' || result.status === 'not_in_collection')
        .map((result) => result.id))

      setData((current) => current.map((item) => {
        if (action === 'add' && addedIds.has(item.id)) return { ...item, discogs_synced_at: syncedAt }
        if (action === 'remove' && removedIds.has(item.id)) return { ...item, discogs_synced_at: null }
        return item
      }))
      setSelectedSyncIds((current) => {
        const next = new Set(current)
        const doneIds = action === 'add' ? addedIds : removedIds
        doneIds.forEach((id) => next.delete(id))
        return next
      })

      const baseSummary = action === 'add'
        ? syncUiText.syncSummary
            .replace('{username}', username)
            .replace('{added}', String(totals.added))
            .replace('{alreadyInCollection}', String(totals.alreadyInCollection))
            .replace('{noRelease}', String(totals.noRelease))
            .replace('{failed}', String(totals.failed))
        : syncUiText.removeSummary
            .replace('{username}', username)
            .replace('{removed}', String(totals.removed))
            .replace('{notInCollection}', String(totals.notInCollection))
            .replace('{failed}', String(totals.failed))

      const skippedNote = skippedRecords.length > 0
        ? ` ${translations[language].table.syncSkippedNoLink.replace('{count}', String(skippedRecords.length))}`
        : ''
      setSyncSummary(`${baseSummary}${skippedNote}`)

      // Per-record report so the user can see exactly why each one was not synced.
      const skippedDetails = skippedRecords.map((record) => ({
        record,
        status: translations[language].table.syncDetailSkipped,
        detail: undefined as string | undefined,
      }))
      setSyncDetails([...skippedDetails, ...allResults.map((result) => {
        const record = recordById.get(result.id)
        const statusLabels: Record<DiscogsSyncResult['status'], string> = {
          added: translations[language].table.syncDetailAdded,
          already_in_collection: translations[language].table.syncDetailAlreadyInCollection,
          removed: translations[language].table.syncDetailRemoved,
          not_in_collection: translations[language].table.syncDetailNotInCollection,
          no_release: translations[language].table.syncDetailNoRelease,
          failed: translations[language].table.syncDetailFailed,
        }
        return {
          record: record ?? ({ id: result.id, artist: result.id, title: null } as VinylRecord),
          status: statusLabels[result.status],
          detail: result.error,
        }
      })])
    } catch (error) {
      console.error('Discogs sync failed:', error)
      const message = error instanceof Error ? error.message : String(error)
      if (/token|401/i.test(message)) {
        window.localStorage.removeItem('spindex-discogs-token')
        const retryToken = window.prompt(syncUiText.discogsTokenInvalid)?.trim() ?? ''
        if (retryToken) {
          window.localStorage.setItem('spindex-discogs-token', retryToken)
          setSyncSummary(null)
          setIsSyncLoading(false)
          setSyncProgress(null)
          return runDiscogsSync(action)
        }
      }
      setSyncSummary(`⚠️ ${message}`)
    } finally {
      setIsSyncLoading(false)
      setSyncProgress(null)
    }
  }

  function syncSelectedRecords() {
    return runDiscogsSync('add')
  }

  async function autoFillSelectedPrices() {
    const recordsToUpdate = selectedUnpricedRecords
    if (recordsToUpdate.length === 0 || isBatchPriceLoading || pendingPriceId !== null) return

    setIsBatchPriceLoading(true)
    setBatchPriceSummary(null)
    let updated = 0
    let unavailable = 0
    let failed = 0
    const updatedRecordIds = new Set<string>()

    try {
      for (const [index, record] of recordsToUpdate.entries()) {
        setPendingPriceId(record.id)
        setBatchPriceProgress({ current: index + 1, total: recordsToUpdate.length })
        try {
          const result = await updateDiscogsPrice(record)
          if (result === 'updated') {
            updated += 1
            updatedRecordIds.add(record.id)
          } else unavailable += 1
        } catch (error) {
          failed += 1
          console.error(`Discogs price lookup failed for record ${record.id}:`, error)
        } finally {
          setPendingPriceId(null)
        }
      }

      setBatchPriceSummary(priceUiText.batchPriceSummary
        .replace('{updated}', String(updated))
        .replace('{unavailable}', String(unavailable))
        .replace('{failed}', String(failed)))
      setSelectedPriceIds((current) => {
        const next = new Set(current)
        updatedRecordIds.forEach((id) => next.delete(id))
        return next
      })
    } finally {
      setPendingPriceId(null)
      setBatchPriceProgress(null)
      setIsBatchPriceLoading(false)
    }
  }

  const columns: ColumnDef<VinylRecord>[] = [
    {
      id: 'expand',
      header: () => null,
      enableSorting: false,
      size: 44,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={row.getIsExpanded() ? t.collapseRow : t.expandRow}
          title={row.getIsExpanded() ? t.collapseRow : t.expandRow}
          onClick={row.getToggleExpandedHandler()}
        >
          {row.getIsExpanded() ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />}
        </Button>
      ),
    },
    {
      accessorKey: 'image_url',
      header: t.cover,
      cell: ({ row }) => {
        const url = row.original.image_url ?? row.original.original_image_url
        return url ? (
          <button
            type="button"
            className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${t.viewCover}: ${row.original.artist ?? ''} - ${row.original.title ?? ''}`}
            title={t.viewCover}
            onClick={() => setPreviewingRecord(row.original)}
          >
            <img src={url} alt={t.cover} className="h-12 w-12 rounded-sm object-cover shadow-sm" />
          </button>
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-sm bg-muted text-center text-[10px] leading-tight text-muted-foreground">{t.noImage}</div>
        )
      },
    },
    { accessorKey: 'artist', header: t.artist },
    { accessorKey: 'title', header: t.title },
    { accessorKey: 'year_pressed', header: t.year },
    { accessorKey: 'genre', header: t.genre },
    {
      id: 'selectUnpriced',
      header: () => (
        <Checkbox
          aria-label={priceUiText.selectAllUnpriced}
          title={priceUiText.selectAllUnpriced}
          checked={unpricedFilteredRecords.length > 0 && selectedFilteredUnpricedCount === unpricedFilteredRecords.length
            ? true
            : selectedFilteredUnpricedCount > 0 ? 'indeterminate' : false}
          disabled={unpricedFilteredRecords.length === 0 || isBatchPriceLoading || pendingPriceId !== null}
          onCheckedChange={(checked) => toggleAllUnpriced(checked === true)}
        />
      ),
      enableSorting: false,
      size: 40,
      cell: ({ row }) => {
        const record = row.original
        if (!hasNoDiscogsPrice(record)) return null

        return (
          <Checkbox
            aria-label={`${priceUiText.selectUnpricedRecord}: ${record.artist ?? ''} - ${record.title ?? ''}`}
            checked={selectedPriceIds.has(record.id)}
            disabled={isBatchPriceLoading || pendingPriceId !== null}
            onCheckedChange={(checked) => {
              setBatchPriceSummary(null)
              setSelectedPriceIds((current) => {
                const next = new Set(current)
                if (checked === true) next.add(record.id)
                else next.delete(record.id)
                return next
              })
            }}
          />
        )
      },
    },
    {
      accessorKey: 'discogs_lowest_price',
      header: t.discogsLowestPrice,
      cell: ({ row }) => {
        const price = row.original.discogs_lowest_price
        if (price === null || price === undefined) {
          const isLoadingPrice = pendingPriceId === row.original.id
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              disabled={pendingPriceId !== null}
              aria-label={t.autoFillDiscogsPrice}
              onClick={() => void autoFillDiscogsPrice(row.original)}
            >
              {isLoadingPrice && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {isLoadingPrice ? t.fetchingDiscogsPrice : t.autoFillDiscogsPrice}
            </Button>
          )
        }
        return new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en-US', {
              style: 'currency',
              currency: 'USD',
            }).format(price)
      },
    },
    {
      accessorKey: 'marketplace_price',
      header: t.marketplacePrice,
      cell: ({ row }) => {
        const price = row.original.marketplace_price
        return price === null || price === undefined
          ? '-'
          : formatMarketplacePrice(price, row.original.marketplace_currency, language)
      },
    },
    {
      accessorKey: 'price_on_discogs',
      header: t.priceOnDiscogs,
      cell: ({ row }) => {
        const price = row.original.price_on_discogs
        return price === null || price === undefined
          ? '-'
          : new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en-US', {
              style: 'currency',
              currency: 'USD',
            }).format(price)
      },
    },
    {
      id: 'discogsSync',
      header: () => (
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${selectedFilteredSyncCount > 0 && selectedFilteredSyncCount === filteredData.length ? 'text-brand-green' : 'text-muted-foreground'}`}
          aria-label={syncUiText.selectAllForSync}
          title={syncUiText.selectAllForSync}
          disabled={filteredData.length === 0}
          onClick={() => toggleAllForSync(selectedFilteredSyncCount !== filteredData.length)}
        >
          <Disc3
            aria-hidden="true"
            fill={selectedFilteredSyncCount > 0 ? 'currentColor' : 'none'}
            fillOpacity={selectedFilteredSyncCount > 0 ? (selectedFilteredSyncCount === filteredData.length ? 0.25 : 0.1) : 0}
          />
        </Button>
      ),
      enableSorting: false,
      size: 44,
      cell: ({ row }) => {
        const record = row.original
        const isSynced = Boolean(record.discogs_synced_at)
        const isSelected = selectedSyncIds.has(record.id)
        const isHighlighted = isSynced || isSelected
        const label = isSynced
          ? t.discogsSynced
          : `${syncUiText.selectRecordForSync}: ${record.artist ?? ''} - ${record.title ?? ''}`
        return (
          <Button
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${isSynced ? 'text-brand-green' : isSelected ? 'text-brand-blue' : 'text-muted-foreground'}`}
            aria-label={label}
            aria-pressed={isSelected}
            title={label}
            onClick={() => {
              setSelectedSyncIds((current) => {
                const next = new Set(current)
                if (next.has(record.id)) next.delete(record.id)
                else next.add(record.id)
                return next
              })
            }}
          >
            <Disc3 aria-hidden="true" fill={isHighlighted ? 'currentColor' : 'none'} fillOpacity={isHighlighted ? 0.25 : 0} />
          </Button>
        )
      },
    },
    {
      id: 'actions',
      header: t.actions,
      enableSorting: false,
      cell: ({ row }) => {
        const record = row.original
        const isPending = pendingActionId === record.id
        let sourceUrl: string | null = null
        try {
          const parsedSourceUrl = new URL(record.source_url ?? '')
          if (parsedSourceUrl.protocol === 'http:' || parsedSourceUrl.protocol === 'https:') {
            sourceUrl = parsedSourceUrl.href
          }
        } catch {
          sourceUrl = null
        }

        return (
          <div className="flex items-center justify-end gap-1">
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t.openFacebookMarketplace}
                title={t.openFacebookMarketplace}
              >
                <span aria-hidden="true" className="flex h-4 w-4 items-end justify-center rounded-[3px] bg-[#1877F2] text-[14px] font-bold leading-[14px] text-white">f</span>
              </a>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 cursor-not-allowed opacity-30"
                aria-label={t.openFacebookMarketplace}
                title={t.openFacebookMarketplace}
                disabled
              >
                <span aria-hidden="true" className="flex h-4 w-4 items-end justify-center rounded-[3px] bg-muted-foreground text-[14px] font-bold leading-[14px] text-background">f</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t.edit}
              title={t.edit}
              disabled={isPending}
              onClick={() => {
                setEditAutoSearch(false)
                setEditingRecord(record)
              }}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${record.sold ? 'text-brand-green' : ''}`}
              aria-label={record.sold ? t.markUnsold : t.markSold}
              title={record.sold ? t.markUnsold : t.markSold}
              disabled={isPending}
              onClick={() => void toggleSold(record)}
            >
              <CircleDollarSign aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              aria-label={t.delete}
              title={t.delete}
              disabled={isPending}
              onClick={() => setDeletingRecord(record)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        )
      },
    },
  ]

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, expanded, pagination },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    onPaginationChange: setPagination,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  if (isLoading) {
    return <div className="animate-pulse rounded-md border p-12 text-center text-muted-foreground">{t.loading}</div>
  }

  if (errorMsg) {
    return <div className="rounded-md border border-destructive p-12 text-center text-destructive">{t.databaseError} {errorMsg}</div>
  }

  return (
    <>
      <div className="mb-5 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            type="search"
            className="max-w-2xl sm:flex-1"
            value={globalSearch}
            onChange={(event) => {
              setGlobalSearch(event.target.value)
              setPagination((current) => ({ ...current, pageIndex: 0 }))
            }}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchRecords}
          />
          <Button
            type="button"
            variant="outline"
            onClick={resetAllFilters}
            disabled={!globalSearch.trim() && !Object.values(advancedFilters).some((value) => value.trim())}
          >
            {filterUiText.resetAll}
          </Button>
        </div>
        <details className="rounded-md border bg-card px-4 py-3 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium">{t.advancedSearch}</summary>
          <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...dropdownFilterFields].map((field) => {
              const value = advancedFilters[field] ?? ''
              const label = t.detailLabels[field as keyof typeof t.detailLabels] ?? field.replace(/_/g, ' ')
              const options = dropdownOptions[field] ?? []

              return (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`filter-${field}`}>{label}</Label>
                  <div className="flex items-center gap-1.5">
                    {autocompleteFilterFields.has(field) ? (
                      <>
                        <Input
                          id={`filter-${field}`}
                          className="min-w-0 flex-1"
                          list={`filter-options-${field}`}
                          value={value}
                          onChange={(event) => updateAdvancedFilter(field, event.target.value)}
                          placeholder={t.filterByField}
                        />
                        <datalist id={`filter-options-${field}`}>
                          {options.map((option) => <option key={option} value={option} />)}
                        </datalist>
                      </>
                    ) : (
                      <Select value={value} onValueChange={(nextValue) => updateAdvancedFilter(field, nextValue)}>
                        <SelectTrigger id={`filter-${field}`} className="min-w-0 flex-1">
                          <SelectValue placeholder={filterUiText.selectValue} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                    {value && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        aria-label={`${filterUiText.clearSelection}: ${label}`}
                        title={`${filterUiText.clearSelection}: ${label}`}
                        onClick={() => clearAdvancedFilter(field)}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {recordFilterFields.filter((field) => !dropdownFilterFields.has(field)).map((field) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={`filter-${field}`}>
                  {t.detailLabels[field as keyof typeof t.detailLabels] ?? field.replace(/_/g, ' ')}
                </Label>
                <Input
                  id={`filter-${field}`}
                  value={advancedFilters[field] ?? ''}
                  onChange={(event) => updateAdvancedFilter(field, event.target.value)}
                  placeholder={t.filterByField}
                />
              </div>
            ))}
          </div>
        </details>
      </div>

      {(selectedUnpricedRecords.length > 0 || isBatchPriceLoading) && (
        <div className="mb-3 flex flex-col gap-3 rounded-md border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {isBatchPriceLoading && batchPriceProgress
              ? `${t.fetchingDiscogsPrice} ${batchPriceProgress.current}/${batchPriceProgress.total}`
              : `${selectedUnpricedRecords.length} ${priceUiText.recordsSelected}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={selectedUnpricedRecords.length === 0 || isBatchPriceLoading || pendingPriceId !== null}
              onClick={() => void autoFillSelectedPrices()}
            >
              {isBatchPriceLoading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <CircleDollarSign aria-hidden="true" />}
              {isBatchPriceLoading ? t.fetchingDiscogsPrice : priceUiText.autoFillSelectedPrices}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isBatchPriceLoading}
              onClick={() => setSelectedPriceIds(new Set())}
            >
              {priceUiText.clearPriceSelection}
            </Button>
          </div>
        </div>
      )}
      {batchPriceSummary && <p className="mb-3 text-sm text-muted-foreground" role="status">{batchPriceSummary}</p>}

      {(selectedSyncIds.size > 0 || isSyncLoading) && (
        <div className="mb-3 flex flex-col gap-3 rounded-md border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              aria-label={syncUiText.selectAllForSync}
              title={syncUiText.selectAllForSync}
              checked={filteredData.length > 0 && selectedFilteredSyncCount === filteredData.length
                ? true
                : selectedFilteredSyncCount > 0 ? 'indeterminate' : false}
              disabled={filteredData.length === 0 || isSyncLoading}
              onCheckedChange={(checked) => toggleAllForSync(checked === true)}
            />
            <p className="text-sm text-muted-foreground">
              {isSyncLoading
                ? syncProgress
                  ? syncUiText.syncingProgress
                      .replace('{current}', String(syncProgress.current))
                      .replace('{total}', String(syncProgress.total))
                  : syncUiText.syncingWithDiscogs
                : `${selectedSyncIds.size} ${syncUiText.recordsSelectedForSync}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={selectedSyncIds.size === 0 || isSyncLoading}
              onClick={() => void syncSelectedRecords()}
            >
              {isSyncLoading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Disc3 aria-hidden="true" />}
              {isSyncLoading ? syncUiText.syncingWithDiscogs : syncUiText.discogsSyncSelected}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={selectedSyncIds.size === 0 || isSyncLoading}
              onClick={() => void runDiscogsSync('remove')}
            >
              {isSyncLoading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              {isSyncLoading ? syncUiText.removingFromDiscogs : syncUiText.removeFromDiscogs}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isSyncLoading}
              onClick={() => setSelectedSyncIds(new Set())}
            >
              {syncUiText.clearSyncSelection}
            </Button>
          </div>
        </div>
      )}
      {syncSummary && (
        <p
          className={`mb-3 text-sm ${syncSummary.startsWith('⚠️') ? 'text-destructive' : 'text-muted-foreground'}`}
          role="status"
        >
          {syncSummary}
        </p>
      )}
      {syncDetails && syncDetails.length > 0 && (
        <details className="mb-3 rounded-md border bg-card px-3 py-2.5 text-sm">
          <summary className="cursor-pointer font-medium">
            {syncUiText.syncResultsTitle} ({syncDetails.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {syncDetails.map(({ record, status, detail }) => {
              const isFailure = Boolean(detail)
              return (
                <li key={record.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 truncate">
                    {record.artist ?? '-'} — {record.title ?? '-'}
                  </span>
                  <span className={isFailure ? 'text-destructive' : 'text-muted-foreground'}>
                    {status}{detail ? `: ${detail}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        </details>
      )}

      <div className="overflow-hidden rounded-md border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/70">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={`h-10 px-3 text-xs font-semibold uppercase tracking-normal ${header.column.id === 'actions' ? 'text-right' : ''}`}>
                    {header.isPlaceholder ? null : !header.column.getCanSort() ? (
                      flexRender(header.column.columnDef.header, header.getContext())
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 px-2 font-medium"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`${String(header.column.columnDef.header)}: ${
                          header.column.getIsSorted() === 'asc'
                            ? t.sortAscending
                            : header.column.getIsSorted() === 'desc'
                              ? t.sortDescending
                              : t.sortColumn
                        }`}
                        title={
                          header.column.getIsSorted() === 'asc'
                            ? t.sortAscending
                            : header.column.getIsSorted() === 'desc'
                              ? t.sortDescending
                              : t.sortColumn
                        }
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' ? (
                          <ArrowUp aria-hidden="true" />
                        ) : header.column.getIsSorted() === 'desc' ? (
                          <ArrowDown aria-hidden="true" />
                        ) : (
                          <ArrowUpDown aria-hidden="true" />
                        )}
                      </Button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const missingDiscogsLink = !getDiscogsReleaseId(row.original.discogs_link)
                const rowClass = [
                  row.original.sold ? 'opacity-50' : '',
                  missingDiscogsLink ? 'bg-amber-500/10' : '',
                ].filter(Boolean).join(' ') || undefined
                return (
                <Fragment key={row.id}>
                  <TableRow key={row.id} className={rowClass}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-3 py-2.5 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && (
                    <TableRow key={`${row.id}-details`} className={row.original.sold ? 'opacity-50' : undefined}>
                      <TableCell colSpan={row.getVisibleCells().length} className="bg-muted/30 px-6 py-5">
                        <h3 className="mb-3 text-sm font-semibold">{t.details}</h3>
                        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                          {Object.entries(row.original)
                            .filter(([key]) => !visibleRecordFields.has(key))
                            .map(([key, value]) => (
                              <div key={key} className="min-w-0">
                                <dt className="text-xs font-medium text-muted-foreground">
                                  {t.detailLabels[key as keyof typeof t.detailLabels] ?? key.replace(/_/g, ' ')}
                                </dt>
                                <dd className="break-words text-sm">
                                  {key === 'original_image_url' && typeof value === 'string' ? (
                                    <button
                                      type="button"
                                      className="mt-1 block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label={`${t.viewOriginalPhoto}: ${row.original.artist ?? ''} - ${row.original.title ?? ''}`}
                                      onClick={() => setPreviewingRecord(row.original)}
                                    >
                                      <img src={value} alt={t.originalPhoto} className="max-h-36 max-w-36 rounded-sm border object-contain" loading="lazy" />
                                    </button>
                                  ) : displayDetailValue(value)}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {t.empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t.recordsFound}: {filteredData.length}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="page-size" className="text-sm">{t.recordsPerPage}</Label>
          <select
            id="page-size"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={pagination.pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
          >
            {[100, 150, 200, 250].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <span className="min-w-24 text-center text-sm text-muted-foreground">
            {t.page} {table.getState().pagination.pageIndex + 1} {t.of} {Math.max(table.getPageCount(), 1)}
          </span>
          <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            {t.previousPage}
          </Button>
          <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            {t.nextPage}
          </Button>
        </div>
      </div>

      <Dialog open={previewingRecord !== null} onOpenChange={(open) => !open && setPreviewingRecord(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewingRecord?.artist} - {previewingRecord?.title}</DialogTitle>
          </DialogHeader>
          <div className={`grid gap-4 ${previewingRecord?.image_url && previewingRecord.original_image_url ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
            {previewingRecord?.image_url && (
              <figure className="space-y-2">
                <figcaption className="text-sm font-medium">{t.discogsCover}</figcaption>
                <img
                  src={previewingRecord.image_url}
                  alt={`${t.discogsCover}: ${previewingRecord.artist ?? ''} - ${previewingRecord.title ?? ''}`}
                  className="mx-auto max-h-[72vh] max-w-full object-contain"
                />
              </figure>
            )}
            {previewingRecord?.original_image_url && (
              <figure className="space-y-2">
                <figcaption className="text-sm font-medium">{t.originalPhoto}</figcaption>
                <img
                  src={previewingRecord.original_image_url}
                  alt={`${t.originalPhoto}: ${previewingRecord.artist ?? ''} - ${previewingRecord.title ?? ''}`}
                  className="mx-auto max-h-[72vh] max-w-full object-contain"
                />
              </figure>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editingRecord !== null} onOpenChange={(open) => !open && setEditingRecord(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{translations[language].form.editRecord}</DialogTitle>
          </DialogHeader>
          {editingRecord && (
            <RecordForm
              key={editingRecord.id}
              language={language}
              record={editingRecord}
              autoSearchDiscogs={editAutoSearch}
              onSuccess={(values) => {
                setData((current) => current.map((item) =>
                  item.id === editingRecord.id ? { ...item, ...values } : item,
                ))
                setEditingRecord(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deletingRecord !== null} onOpenChange={(open) => !open && setDeletingRecord(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deleteTitle}</DialogTitle>
            <DialogDescription>
              {t.deleteDescription} {deletingRecord?.artist} - {deletingRecord?.title}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t.cancel}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pendingActionId === deletingRecord?.id}
              onClick={() => void confirmDelete()}
            >
              <Trash2 aria-hidden="true" />
              {t.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
