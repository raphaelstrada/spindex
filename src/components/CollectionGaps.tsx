import { useMemo, useState } from 'react'
import { ChevronDown, LoaderCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCollectionOwner } from '@/lib/collection'
import { getArtistDiscography, getDiscogsReleaseId, type DiscogsArtistAlbum } from '@/lib/discogs'
import { translations, type Language } from '@/lib/i18n'
import { normalizeMatchText, type VinylRecord } from '@/lib/record'

const TOP_ARTISTS = 10
const ALBUMS_PER_ARTIST = 6

type CachedGaps = { checkedAt: string; artists: { artist: string; items: DiscogsArtistAlbum[] }[] }

function cacheKey(owner: string) {
  return `spindex-collection-gaps-${owner}`
}

function readCache(owner: string): CachedGaps | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(owner))
    return raw ? JSON.parse(raw) as CachedGaps : null
  } catch {
    return null
  }
}

/**
 * Albums by the admin's top artists that are not in the collection, from the Discogs discography.
 * Discogs is only queried on demand; the discographies are cached in this browser, and the
 * "owned" comparison always uses the current records, so a newly added record disappears at once.
 */
export function CollectionGaps({ records, language }: { records: VinylRecord[]; language: Language }) {
  const owner = useCollectionOwner()
  const t = translations[language].gaps
  const [isOpen, setIsOpen] = useState(false)
  const [cache, setCache] = useState<CachedGaps | null>(() => readCache(owner))
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const owned = useMemo(() => records.filter((record) => !record.sold && record.artist), [records])

  // Top artists by owned count, each with one Discogs release to find the artist on Discogs.
  const topArtists = useMemo(() => {
    const byArtist = new Map<string, { artist: string; count: number; releaseId: number | null }>()
    for (const record of owned) {
      const key = normalizeMatchText(record.artist ?? '')
      if (!key || key === 'various' || key === 'various artists') continue
      const entry = byArtist.get(key) ?? { artist: record.artist ?? '', count: 0, releaseId: null }
      entry.count += 1
      entry.releaseId ??= getDiscogsReleaseId(record.discogs_link)
      byArtist.set(key, entry)
    }
    return [...byArtist.values()]
      .filter((entry) => entry.releaseId !== null)
      .sort((left, right) => right.count - left.count)
      .slice(0, TOP_ARTISTS)
  }, [owned])

  const groups = useMemo(() => (cache?.artists ?? []).map(({ artist, items }) => {
    const artistKey = normalizeMatchText(artist)
    const ownedTitles = new Set(owned
      .filter((record) => normalizeMatchText(record.artist ?? '') === artistKey)
      .map((record) => normalizeMatchText(record.title ?? '')))
    const missing = items
      .filter((item) => !ownedTitles.has(normalizeMatchText(item.title)))
      .sort((left, right) => right.inCollection - left.inCollection)
    return { artist, ownedCount: ownedTitles.size, missing }
  }).filter((group) => group.missing.length > 0), [cache, owned])

  async function findGaps() {
    setError(null)
    setProgress({ current: 0, total: topArtists.length })
    const artists: CachedGaps['artists'] = []
    try {
      // Sequential on purpose: Discogs allows 60 requests per minute.
      for (const [index, entry] of topArtists.entries()) {
        setProgress({ current: index + 1, total: topArtists.length })
        const discography = await getArtistDiscography(entry.releaseId as number)
        artists.push({ artist: entry.artist, items: discography.items })
      }
      const next = { checkedAt: new Date().toISOString(), artists }
      setCache(next)
      try {
        window.localStorage.setItem(cacheKey(owner), JSON.stringify(next))
      } catch {
        // The cache only saves Discogs calls.
      }
    } catch (findError) {
      setError(`${t.failed} ${findError instanceof Error ? findError.message : String(findError)}`)
    } finally {
      setProgress(null)
    }
  }

  return (
    <section className="mb-5 rounded-md border bg-card shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={isOpen}
        aria-controls="collection-gaps-panel"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t.title}</span>
        <span className="truncate text-muted-foreground">{t.summary}</span>
        <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {isOpen && (
        <div id="collection-gaps-panel" className="space-y-3 border-t px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={progress !== null || topArtists.length === 0} onClick={() => void findGaps()}>
              {progress ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
              {cache ? t.refresh : t.find}
            </Button>
            <p className="text-sm text-muted-foreground" role="status">
              {progress
                ? t.loading.replace('{current}', String(progress.current)).replace('{total}', String(progress.total))
                : topArtists.length === 0
                  ? t.noArtists
                  : cache
                    ? t.checkedAt.replace('{date}', new Date(cache.checkedAt).toLocaleString(language === 'pt' ? 'pt-BR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }))
                    : null}
            </p>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {cache && groups.length === 0 && !progress && <p className="text-sm text-muted-foreground">{t.nothingMissing}</p>}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <section key={group.artist} className="rounded-md border bg-background px-3 py-2.5">
                <h3 className="text-sm font-medium">{group.artist}</h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t.youHave.replace('{count}', String(group.ownedCount))} · {t.missingCount.replace('{count}', String(group.missing.length))}
                </p>
                <ul className="space-y-1.5">
                  {group.missing.slice(0, ALBUMS_PER_ARTIST).map((item) => (
                    <li key={item.masterId}>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-sm text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={t.owners.replace('{count}', String(item.inCollection))}
                      >
                        {item.thumb
                          ? <img src={item.thumb} alt="" className="h-9 w-9 shrink-0 rounded-sm object-cover" loading="lazy" />
                          : <span className="h-9 w-9 shrink-0 rounded-sm bg-muted" aria-hidden="true" />}
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        {item.year && <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{item.year}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
