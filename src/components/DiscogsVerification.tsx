import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, ExternalLink, LoaderCircle, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCollectionOwner } from '@/lib/collection'
import {
  VERIFICATION_COLUMNS,
  diffRecord,
  useDiscogsVerification,
  type DiscogsConflict,
  type FieldDiff,
  type KeyField,
  type UpdatableField,
} from '@/lib/discogsVerification'
import { translations, type Language } from '@/lib/i18n'
import type { VinylRecord } from '@/lib/record'
import { supabase } from '@/lib/supabase'

function fieldLabel(field: UpdatableField | KeyField, language: Language) {
  const form = translations[language].form
  const labels: Record<UpdatableField | KeyField, string> = {
    title: form.albumTitle.replace(' *', ''),
    record_label: form.recordLabel,
    record_type: form.type,
    record_size: form.size,
    genre: form.genre,
    sub_genre: form.subGenre,
    image_url: form.coverImageUrl,
    catalog_number: 'Cat#',
    artist: form.artist.replace(' *', ''),
    year_pressed: form.yearPressed,
    country_pressed: form.country,
  }
  return labels[field]
}

function FieldValue({ field, value, alt }: { field: string; value: unknown; alt: string }) {
  if (value === null || value === undefined || value === '') return <p className="mt-1 text-sm">-</p>
  if (field === 'image_url') return <img src={String(value)} alt={alt} className="mt-1 h-14 w-14 rounded-sm object-cover" />
  return <p className="break-words text-sm">{String(value)}</p>
}

export function DiscogsVerification({ language, onRecordsChanged }: { language: Language; onRecordsChanged: () => void }) {
  const t = translations[language].discogsCheck
  const owner = useCollectionOwner()
  const verification = useDiscogsVerification(owner, onRecordsChanged)
  const [isStarting, setIsStarting] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [reviewing, setReviewing] = useState<DiscogsConflict | null>(null)

  async function start() {
    setIsStarting(true)
    try {
      await verification.start()
    } catch (error) {
      alert(`${t.startError} ${error instanceof Error ? error.message : ''}`)
    } finally {
      setIsStarting(false)
    }
  }

  const warningClass = 'bg-amber-500 text-black hover:bg-amber-500/90'

  return (
    <>
      {verification.status === 'running' ? (
        <Button
          className={warningClass}
          title={t.stopHint}
          onClick={() => {
            if (window.confirm(t.stopConfirm)) verification.stop()
          }}
        >
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          {t.verifying
            .replace('{current}', String(verification.position))
            .replace('{total}', String(verification.queue.length))}
        </Button>
      ) : verification.status === 'done' ? (
        <Button className={warningClass} onClick={() => setListOpen(true)}>
          <AlertTriangle aria-hidden="true" />
          {t.showConflicts.replace('{count}', String(verification.conflicts.length))}
        </Button>
      ) : (
        <Button className={warningClass} title={t.verifyHint} disabled={isStarting} onClick={() => void start()}>
          {isStarting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
          {t.verify}
        </Button>
      )}

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t.conflictsTitle}</DialogTitle>
            <DialogDescription>
              {t.conflictsDescription}
              {verification.finishedAt && ` ${t.lastRun.replace('{date}', new Date(verification.finishedAt).toLocaleString(language === 'pt' ? 'pt-BR' : 'en-CA'))}`}
            </DialogDescription>
          </DialogHeader>
          {verification.conflicts.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t.noConflicts}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16" />
                  <TableHead>{fieldLabel('artist', language)}</TableHead>
                  <TableHead>{fieldLabel('title', language)}</TableHead>
                  <TableHead>Cat#</TableHead>
                  <TableHead>{t.differences}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verification.conflicts.map((conflict) => (
                  <TableRow
                    key={conflict.recordId}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setReviewing(conflict)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setReviewing(conflict)
                      }
                    }}
                  >
                    <TableCell>
                      <img src={conflict.release.thumbnail} alt="" className="h-10 w-10 rounded-sm object-cover" />
                    </TableCell>
                    <TableCell>{conflict.artist || '-'}</TableCell>
                    <TableCell>{conflict.title || '-'}</TableCell>
                    <TableCell className="font-mono">{conflict.catalogNumber || '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {conflict.keyMismatches.length > 0 && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                            {t.keyMismatch}
                          </span>
                        )}
                        {conflict.fields.map((field) => (
                          <span key={field.key} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            {fieldLabel(field.key, language)}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {verification.failures.length > 0 && (
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {t.failuresTitle.replace('{count}', String(verification.failures.length))}
              </summary>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {verification.failures.map((failure) => (
                  <li key={failure.recordId}>
                    {failure.artist || '-'} – {failure.title || '-'}: {failure.error === 'NO_DATA' ? t.noData : failure.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isStarting}
              onClick={() => {
                setListOpen(false)
                void start()
              }}
            >
              {t.runAgain}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {reviewing && (
        <ConflictReviewDialog
          key={reviewing.recordId}
          language={language}
          conflict={reviewing}
          onClose={() => setReviewing(null)}
          onResolved={(keptValues, changed) => {
            verification.resolve(reviewing.recordId, keptValues)
            setReviewing(null)
            if (changed) onRecordsChanged()
          }}
        />
      )}
    </>
  )
}

function ConflictReviewDialog({ language, conflict, onClose, onResolved }: {
  language: Language
  conflict: DiscogsConflict
  onClose: () => void
  onResolved: (keptValues: { key: string; discogs: string | number }[], changed: boolean) => void
}) {
  const t = translations[language].discogsCheck
  const form = translations[language].form
  // Compared again against the current record: it may have been edited since the verification ran.
  const [diff, setDiff] = useState<{ fields: FieldDiff<UpdatableField>[]; keyMismatches: FieldDiff<KeyField>[] } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [useDiscogs, setUseDiscogs] = useState<Set<UpdatableField>>(new Set())
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let active = true
    void supabase.from('vinyl_records').select(VERIFICATION_COLUMNS).eq('id', conflict.recordId).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error || !data) {
          setLoadError(error?.message ?? t.recordMissing)
          return
        }
        setDiff(diffRecord(data as VinylRecord, conflict.release, {}))
      })
    return () => {
      active = false
    }
  }, [conflict, t.recordMissing])

  function toggle(field: UpdatableField) {
    setUseDiscogs((current) => {
      const next = new Set(current)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  async function save() {
    if (!diff) return
    setIsSaving(true)
    const changes = Object.fromEntries(diff.fields.filter((field) => useDiscogs.has(field.key)).map((field) => [field.key, field.discogs]))
    if (Object.keys(changes).length > 0) {
      const { error } = await supabase.from('vinyl_records').update(changes).eq('id', conflict.recordId)
      if (error) {
        setIsSaving(false)
        alert(`${t.saveError} ${error.message}`)
        return
      }
    }
    onResolved(
      [...diff.fields.filter((field) => !useDiscogs.has(field.key)), ...diff.keyMismatches],
      Object.keys(changes).length > 0,
    )
  }

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open && !isSaving) onClose()
    }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.reviewTitle}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2">
            <span>{conflict.release.title}</span>
            <a
              href={conflict.release.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              {t.openOnDiscogs}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </DialogDescription>
          {/* Saved during the verification; conflicts stored before market prices existed have none. */}
          {conflict.market && (conflict.market.price !== null || conflict.market.numForSale !== null) && (
            <p className="text-sm text-muted-foreground">
              {[
                conflict.market.price !== null && t.marketPrice
                  .replace('{condition}', conflict.market.condition ?? 'VG+')
                  .replace('{price}', new Intl.NumberFormat(language === 'pt' ? 'pt-BR' : 'en-US', {
                    style: 'currency',
                    currency: conflict.market.currency || 'USD',
                  }).format(conflict.market.price)),
                conflict.market.numForSale !== null && translations[language].table.forSale.replace('{count}', String(conflict.market.numForSale)),
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </DialogHeader>

        {loadError ? (
          <p className="py-4 text-sm text-destructive" role="alert">{loadError}</p>
        ) : !diff ? (
          <p className="py-4 text-sm text-muted-foreground">{t.loading}</p>
        ) : (
          <>
            {diff.keyMismatches.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                  {t.keyMismatch}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t.keyMismatchHelp}</p>
                <div className="mt-2 divide-y">
                  {diff.keyMismatches.map((field) => (
                    <div key={field.key} className="grid grid-cols-2 gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">{fieldLabel(field.key, language)} · {form.currentValue}</p>
                        <FieldValue field={field.key} value={field.current} alt={form.currentValue} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">{fieldLabel(field.key, language)} · Discogs</p>
                        <FieldValue field={field.key} value={field.discogs} alt="Discogs" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {diff.fields.length > 0 ? (
              <div className="divide-y">
                {diff.fields.map((field) => {
                  const takeDiscogs = useDiscogs.has(field.key)
                  const label = fieldLabel(field.key, language)
                  return (
                    <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-3 py-3">
                      <div className={`min-w-0 rounded-md p-2 ${takeDiscogs ? 'opacity-50' : 'ring-2 ring-primary'}`}>
                        <p className="text-xs font-medium text-muted-foreground">{label} · {form.currentValue}</p>
                        <FieldValue field={field.key} value={field.current} alt={form.currentValue} />
                      </div>
                      <Button
                        type="button"
                        variant={takeDiscogs ? 'default' : 'outline'}
                        size="icon"
                        className="h-9 w-9"
                        aria-pressed={takeDiscogs}
                        aria-label={`${takeDiscogs ? t.keepOriginal : form.applyDiscogsField}: ${label}`}
                        title={`${takeDiscogs ? t.keepOriginal : form.applyDiscogsField}: ${label}`}
                        onClick={() => toggle(field.key)}
                      >
                        {takeDiscogs ? <ArrowLeft aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                      </Button>
                      <div className={`min-w-0 rounded-md p-2 ${takeDiscogs ? 'ring-2 ring-primary' : 'opacity-50'}`}>
                        <p className="text-xs font-medium text-muted-foreground">{label} · {form.discogsSuggestion}</p>
                        <FieldValue field={field.key} value={field.discogs} alt={form.discogsSuggestion} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : diff.keyMismatches.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">{form.noDiscogsDifferences}</p>
            )}
          </>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {diff && diff.fields.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setUseDiscogs(useDiscogs.size === diff.fields.length
                ? new Set()
                : new Set(diff.fields.map((field) => field.key)))}
            >
              {useDiscogs.size === diff.fields.length ? t.keepAllOriginal : t.useAllDiscogs}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={isSaving} onClick={onClose}>{t.cancel}</Button>
          <Button type="button" disabled={!diff || isSaving} onClick={() => void save()}>
            {isSaving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
