import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DiscogsRelease } from '@/lib/discogs'

/**
 * Shared "possible Discogs releases" box, shown ABOVE the record form.
 * Used by the photo import and the barcode import so both look and behave the same.
 */
export function DiscogsCandidatePicker({
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
        <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {candidates.map((release) => {
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
