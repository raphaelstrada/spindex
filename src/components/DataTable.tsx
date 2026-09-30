import { Fragment, useEffect, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleDollarSign,
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { RecordForm } from '@/components/RecordForm'
import { Button } from '@/components/ui/button'
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
import { getDiscogsLowestPrice, getDiscogsReleaseId, searchDiscogsReleases } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'
import type { VinylRecord } from '@/lib/record'

const visibleRecordFields = new Set(['image_url', 'artist', 'title', 'year_pressed', 'genre', 'discogs_lowest_price'])

export function DataTable({ language, recordsVersion }: { language: Language; recordsVersion: number }) {
  const [data, setData] = useState<VinylRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'artist', desc: false }])
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const [editingRecord, setEditingRecord] = useState<VinylRecord | null>(null)
  const [deletingRecord, setDeletingRecord] = useState<VinylRecord | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [pendingPriceId, setPendingPriceId] = useState<string | null>(null)
  const t = translations[language].table
  const [activeOwner, setActiveOwner] = useState<'Raphael' | 'Tim' | 'Other User'>('Raphael')

  useEffect(() => {
    async function fetchRecords() {
      setIsLoading(true)
      setErrorMsg(null)
      const { data: records, error } = await supabase
        .from('vinyl_records')
        .select('*')
        .eq('collection_owner', activeOwner) // A mágica acontece aqui
        .order('artist', { ascending: true })

      if (error) {
        console.error('Supabase fetch error:', error)
        setErrorMsg(error.message)
      } else {
        setData((records || []) as VinylRecord[])
      }
      setIsLoading(false)
    }
    fetchRecords()
  }, [recordsVersion, activeOwner])

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

  async function autoFillDiscogsPrice(record: VinylRecord) {
    setPendingPriceId(record.id)
    try {
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

      if (!releaseId) {
        alert(t.noExactDiscogsRelease)
        return
      }

      const stats = await getDiscogsLowestPrice(releaseId)
      if (stats.lowestPrice === null) {
        alert(t.noDiscogsPrice)
        return
      }

      const { error } = await supabase
        .from('vinyl_records')
        .update({ discogs_lowest_price: stats.lowestPrice })
        .eq('id', record.id)

      if (error) {
        alert(`${t.updateFailed} ${error.message}`)
        return
      }

      setData((current) => current.map((item) =>
        item.id === record.id ? { ...item, discogs_lowest_price: stats.lowestPrice } : item,
      ))
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
        const url = row.original.image_url
        return url ? (
          <img src={url} alt={t.cover} className="h-12 w-12 rounded-sm object-cover shadow-sm" />
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
              onClick={() => setEditingRecord(record)}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${record.sold ? 'text-emerald-700' : ''}`}
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
    data,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (isLoading) {
    return <div className="animate-pulse rounded-md border p-12 text-center text-muted-foreground">{t.loading}</div>
  }

  if (errorMsg) {
    return <div className="rounded-md border border-destructive p-12 text-center text-destructive">{t.databaseError} {errorMsg}</div>
  }

  return (
    <>
      <div className="flex space-x-2 mb-4">
        {['Raphael', 'Tim', 'Other user'].map((owner) => (
          <Button
            key={owner}
            variant={activeOwner === owner ? "default" : "outline"}
            onClick={() => setActiveOwner(owner as any)}
            className="w-32"
          >
            {owner}
          </Button>
        ))}
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className={header.column.id === 'actions' ? 'text-right' : undefined}>
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
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow key={row.id} className={row.original.sold ? 'opacity-50' : undefined}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="align-middle">
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
                                <dd className="break-words text-sm">{displayDetailValue(value)}</dd>
                              </div>
                            ))}
                        </dl>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
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
