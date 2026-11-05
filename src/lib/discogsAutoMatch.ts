import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getDiscogsReleaseId, searchDiscogsFirstPage, sortReleasesByCountryPriority, type DiscogsRelease } from '@/lib/discogs'
import { normalizeArtist, recordReleaseId } from '@/lib/discogsVerification'
import type { CollectionOwner } from '@/lib/collection'
import type { VinylRecord } from '@/lib/record'
import { detectSetupIssue } from '@/lib/setupIssues'

/** The 90% rule: it decides the Discogs URL only. It means "same album", never "same pressing". */
export const MATCH_THRESHOLD = 0.9
const MIN_FIELD_SIMILARITY = 0.8

export type DiscogsMatchStatus = 'provisional' | 'ambiguous' | 'no_match'

export type DiscogsMatch = {
  status: DiscogsMatchStatus
  score: number
  /** The accepted release: only set when status is 'provisional'. */
  release: DiscogsRelease | null
  /** First real cover of the search, in Discogs order. Not bound by the 90% rule. */
  fallbackCover: string | null
  requests: number
}

type AutoMatchRecord = Pick<VinylRecord, 'id' | 'artist' | 'title' | 'image_url' | 'discogs_link' | 'discogs_auto_cover'>

const AUTO_MATCH_COLUMNS = 'id, artist, title, image_url, discogs_link, discogs_auto_match, discogs_auto_cover'

// Discogs answers with a placeholder when a release has no image.
function isRealCover(url: string | null | undefined): url is string {
  return Boolean(url) && !url!.includes('spacer.gif')
}

function editDistance(left: string[], right: string[]) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    const current = [i]
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[right.length]
}

/** 1 = identical, 0 = nothing in common. Empty text never matches. */
function similarity(left: string, right: string) {
  const [leftCharacters, rightCharacters] = [[...normalizeArtist(left)], [...normalizeArtist(right)]]
  if (leftCharacters.length === 0 || rightCharacters.length === 0) return 0
  return 1 - editDistance(leftCharacters, rightCharacters) / Math.max(leftCharacters.length, rightCharacters.length)
}

/** Picks the release to link, or explains why none is safe. Results must be in Discogs order. */
export function decideMatch(artist: string, title: string, results: DiscogsRelease[]): Omit<DiscogsMatch, 'requests'> {
  const fallbackCover = results.find((release) => isRealCover(release.coverImage))?.coverImage ?? null
  const scored = results.map((release) => {
    const artistSimilarity = similarity(artist, release.artist)
    const titleSimilarity = similarity(title, release.releaseTitle)
    return { release, artistSimilarity, titleSimilarity, score: (artistSimilarity + titleSimilarity) / 2 }
  })
  const score = Math.round(Math.max(0, ...scored.map((item) => item.score)) * 1000) / 1000
  const noMatch = { status: 'no_match' as const, score, release: null, fallbackCover }

  // Discogs credits every compilation to "Various", so the artist proves nothing.
  if (normalizeArtist(artist) === 'various') return noMatch

  const candidates = scored
    .filter((item) => item.score >= MATCH_THRESHOLD
      && item.artistSimilarity >= MIN_FIELD_SIMILARITY && item.titleSimilarity >= MIN_FIELD_SIMILARITY)
    .map((item) => item.release)
  if (candidates.length === 0) return noMatch

  // Same artist and title on two masters = two albums (self-titled, "Greatest Hits"...). Without the
  // master id there is no way to tell, so the record is treated the same way. Master 0 = none, not a rival.
  const masters = new Set(candidates.map((release) => release.masterId).filter((masterId) => masterId !== 0))
  if (masters.size > 1 || masters.has(undefined) || masters.has(null)) {
    return { status: 'ambiguous', score, release: null, fallbackCover }
  }

  const [master] = masters
  const release = sortReleasesByCountryPriority(candidates.filter((candidate) => master === undefined || candidate.masterId === master))
    .find((candidate) => isRealCover(candidate.coverImage))
  return release ? { status: 'provisional', score, release, fallbackCover } : noMatch
}

/** Reads Discogs and decides; writes nothing. */
export async function findDiscogsMatch(artist: string, title: string): Promise<DiscogsMatch> {
  let results = await searchDiscogsFirstPage({ artist, title })
  let requests = 1
  if (results.length === 0) {
    // Tolerates misreadings (typed, or from the cover recognition) that the strict fields reject.
    results = await searchDiscogsFirstPage({ freeText: `${artist} ${title}` })
    requests += 1
  }
  return { ...decideMatch(artist, title, results), requests }
}

/** Finds the match and saves it. Only touches the link, the cover and the auto-match columns. */
export async function matchRecord(record: AutoMatchRecord, owner: CollectionOwner) {
  const match = await findDiscogsMatch(record.artist ?? '', record.title ?? '')
  const hasNoCover = !record.image_url?.trim()
  const changes: Partial<VinylRecord> = {
    discogs_auto_match: match.status,
    discogs_auto_match_score: match.score,
    discogs_auto_matched_at: new Date().toISOString(),
  }

  if (match.release) {
    changes.discogs_link = match.release.url
    if (hasNoCover || record.discogs_auto_cover) {
      changes.image_url = match.release.coverImage
      changes.discogs_auto_cover = false
    }
  } else if (hasNoCover && match.fallbackCover) {
    changes.image_url = match.fallbackCover
    changes.discogs_auto_cover = true
  }

  const { error } = await supabase.from('vinyl_records').update(changes).eq('id', record.id).eq('collection_owner', owner)
  if (error) throw new Error(error.message)
  return { ...match, coverAdded: changes.image_url !== undefined }
}

export type AutoMatchFailure = { recordId: string; artist: string | null; title: string | null; error: string }

type AutoMatchState = {
  status: 'idle' | 'running' | 'done'
  queue: string[]
  position: number
  matched: number
  ambiguous: number
  noMatch: number
  covers: number
  failures: AutoMatchFailure[]
  finishedAt: string | null
}

// Same pace as the Discogs verification: Discogs allows 60 authenticated requests per minute.
const REQUEST_INTERVAL_MS = 1500
const RATE_LIMIT_WAIT_MS = 60_000
const MAX_RATE_LIMIT_RETRIES = 5

const EMPTY_STATE: AutoMatchState = {
  status: 'idle', queue: [], position: 0, matched: 0, ambiguous: 0, noMatch: 0, covers: 0, failures: [], finishedAt: null,
}

function storageKey(owner: CollectionOwner) {
  return `spindex-discogs-auto-match-${owner}`
}

function loadState(owner: CollectionOwner): AutoMatchState {
  try {
    const stored = window.localStorage.getItem(storageKey(owner))
    return stored ? { ...EMPTY_STATE, ...JSON.parse(stored) as Partial<AutoMatchState> } : EMPTY_STATE
  } catch {
    return EMPTY_STATE
  }
}

/** Both tools share the Discogs rate limit, so only one runs at a time. */
export function isAutoMatchRunning(owner: CollectionOwner) {
  return loadState(owner).status === 'running'
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Same design as useDiscogsVerification: runs at the page level and a reload resumes where it stopped. */
export function useDiscogsAutoMatch(owner: CollectionOwner, onRecordsChanged: () => void) {
  const [state, setState] = useState<AutoMatchState>(() => loadState(owner))
  const stateRef = useRef(state)
  // The parent passes a new function on every render; that must not restart the run.
  const recordsChanged = useRef(onRecordsChanged)
  useEffect(() => {
    recordsChanged.current = onRecordsChanged
  }, [onRecordsChanged])

  const update = useCallback((change: (current: AutoMatchState) => AutoMatchState) => {
    const next = change(stateRef.current)
    stateRef.current = next
    setState(next)
    try {
      window.localStorage.setItem(storageKey(owner), JSON.stringify(next))
    } catch (error) {
      console.error('Could not save the Discogs auto-match progress:', error)
    }
  }, [owner])

  useEffect(() => {
    if (state.status !== 'running') return
    let cancelled = false
    const finish = () => {
      update((current) => ({ ...current, status: 'done', finishedAt: new Date().toISOString() }))
      recordsChanged.current()
    }

    async function run() {
      let rateLimitRetries = 0
      while (!cancelled && stateRef.current.position < stateRef.current.queue.length) {
        const recordId = stateRef.current.queue[stateRef.current.position]
        let label: Pick<AutoMatchFailure, 'artist' | 'title'> = { artist: null, title: null }
        let result: Awaited<ReturnType<typeof matchRecord>> | null = null
        let failure: AutoMatchFailure | null = null
        const startedAt = Date.now()

        try {
          // Read right before saving: the admin may have edited the record since the queue was built.
          const { data, error } = await supabase.from('vinyl_records').select(AUTO_MATCH_COLUMNS)
            .eq('id', recordId).eq('collection_owner', owner).maybeSingle()
          if (error) throw new Error(error.message)
          const record = data as AutoMatchRecord | null
          if (record) label = { artist: record.artist, title: record.title }
          if (record?.artist?.trim() && record.title?.trim() && getDiscogsReleaseId(record.discogs_link) === null) {
            result = await matchRecord(record, owner)
          }
        } catch (matchError) {
          const message = matchError instanceof Error ? matchError.message : String(matchError)
          // A setup problem (explained by the setup dialog) would fail every record: stop here.
          if (detectSetupIssue(message)) {
            finish()
            return
          }
          if (/\b429\b/.test(message) && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            rateLimitRetries += 1
            await wait(RATE_LIMIT_WAIT_MS)
            continue
          }
          failure = { recordId, ...label, error: message }
        }
        if (cancelled) return

        if (result || failure) {
          await wait(Math.max(0, REQUEST_INTERVAL_MS * (result?.requests ?? 1) - (Date.now() - startedAt)))
        }
        if (cancelled) return

        rateLimitRetries = 0
        update((current) => ({
          ...current,
          position: current.position + 1,
          matched: current.matched + Number(result?.status === 'provisional'),
          ambiguous: current.ambiguous + Number(result?.status === 'ambiguous'),
          noMatch: current.noMatch + Number(result?.status === 'no_match'),
          covers: current.covers + Number(Boolean(result?.coverAdded)),
          failures: failure ? [...current.failures, failure] : current.failures,
        }))
      }

      if (!cancelled) finish()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [state.status, owner, update])

  /** retry = records a previous run could not link. Otherwise, only records never processed. */
  const start = useCallback(async (retry = false) => {
    const { data, error } = await supabase.from('vinyl_records')
      .select('id, artist, title, image_url, discogs_link, discogs_auto_match')
      .eq('collection_owner', owner)
    if (error) throw new Error(error.message)

    const queue = ((data ?? []) as VinylRecord[])
      .filter((record) => record.artist?.trim() && record.title?.trim())
      .filter((record) => (retry
        ? record.discogs_auto_match && getDiscogsReleaseId(record.discogs_link) === null
        : !record.discogs_auto_match && recordReleaseId(record) === null))
      .map((record) => record.id)
    update(() => ({ ...EMPTY_STATE, status: 'running', queue }))
  }, [owner, update])

  // Stops early; what was already saved stays saved.
  const stop = useCallback(() => {
    update((current) => ({ ...current, status: 'done', finishedAt: new Date().toISOString() }))
    recordsChanged.current()
  }, [update])

  return { ...state, start, stop }
}
