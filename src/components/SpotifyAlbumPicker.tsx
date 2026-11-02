import { useState } from 'react'
import { Check, ExternalLink, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { translations, type Language } from '@/lib/i18n'
import type { SpotifyAlbumCandidate } from '@/lib/spotify'

/**
 * "Probable Spotify albums" dialog, same look as the Discogs candidate picker.
 * The search runs in the parent; render it with a `key` that changes for each search.
 */
export function SpotifyAlbumPicker({
  language,
  open,
  query,
  isLoading,
  error,
  candidates,
  initialSelectedId,
  onOpenChange,
  onConfirm,
}: {
  language: Language
  open: boolean
  query: string
  isLoading: boolean
  error: string | null
  candidates: SpotifyAlbumCandidate[]
  initialSelectedId: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (album: SpotifyAlbumCandidate) => void
}) {
  const t = translations[language].form
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const selected = candidates.find((candidate) => candidate.id === (selectedId ?? candidates[0]?.id)) ?? null
  const albumTypeLabel = (type: string) => t.spotifyAlbumTypes[type as keyof typeof t.spotifyAlbumTypes] ?? type

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.spotifyPickerTitle}</DialogTitle>
          <DialogDescription>{t.spotifyPickerHint.replace('{query}', query)}</DialogDescription>
        </DialogHeader>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t.spotifySearching}
          </p>
        ) : candidates.length === 0 ? (
          !error && <p className="text-sm text-muted-foreground">{t.spotifyNoMatches}</p>
        ) : (
          <div className="grid max-h-[50vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {candidates.map((album) => {
              const isSelected = selected?.id === album.id
              return (
                <button
                  key={album.id}
                  type="button"
                  className={`flex min-w-0 items-center gap-3 rounded-md border p-2 text-left transition-colors hover:bg-accent ${isSelected ? 'border-primary bg-accent/50' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(album.id)}
                  onDoubleClick={() => onConfirm(album)}
                >
                  {album.image
                    ? <img src={album.image} alt="" className="h-14 w-14 shrink-0 rounded-sm object-cover" loading="lazy" />
                    : <span className="h-14 w-14 shrink-0 rounded-sm bg-muted" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block line-clamp-2 text-sm font-medium">{album.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{album.artists}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {album.exactMatch && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">{t.spotifyExactMatch}</span>}
                      {[album.year, albumTypeLabel(album.albumType), album.totalTracks != null ? t.spotifyTracks.replace('{count}', String(album.totalTracks)) : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {selected ? (
            <Button asChild variant="ghost">
              <a href={selected.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                {translations[language].spotify.openOnSpotify}
              </a>
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t.spotifyPickerCancel}</Button>
            <Button type="button" disabled={!selected || isLoading} onClick={() => selected && onConfirm(selected)}>
              {t.useSpotifyAlbum}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
