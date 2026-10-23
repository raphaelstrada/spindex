import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getDiscogsReleaseId, searchDiscogsReleases, type DiscogsRelease } from '@/lib/discogs'
import type { CollectionOwner } from '@/lib/collection'
import type { VinylRecord } from '@/lib/record'

/** Identify the pressing: never updated from Discogs, only reported when they differ. */
export const KEY_FIELDS = ['catalog_number', 'artist', 'year_pressed', 'country_pressed'] as const
/** Fields the admin may update from Discogs. */
export const UPDATABLE_FIELDS = ['title', 'record_label', 'record_type', 'record_size', 'genre', 'sub_genre', 'image_url'] as const

export type KeyField = typeof KEY_FIELDS[number]
export type UpdatableField = typeof UPDATABLE_FIELDS[number]
export type FieldDiff<K extends string> = { key: K; current: string | number | null; discogs: string | number }

export type DiscogsConflict = {
  recordId: string
  artist: string | null
  title: string | null
  catalogNumber: string | null
  release: DiscogsRelease
  fields: FieldDiff<UpdatableField>[]
  keyMismatches: FieldDiff<KeyField>[]
}

export type VerificationFailure = { recordId: string; artist: string | null; title: string | null; error: string }

type VerificationState = {
  status: 'idle' | 'running' | 'done'
  queue: string[]
  position: number
  conflicts: DiscogsConflict[]
  failures: VerificationFailure[]
  finishedAt: string | null
  /** `${recordId}:${field}` -> Discogs value the admin chose not to apply. Not flagged again while unchanged. */
  kept: Record<string, string>
}

export const VERIFICATION_COLUMNS = 'id, artist, title, year_pressed, catalog_number, country_pressed, record_label, record_type, record_size, genre, sub_genre, image_url, discogs_link'

// Discogs allows 60 authenticated requests per minute; stay below it so the rest of the admin keeps working.
const REQUEST_INTERVAL_MS = 1500
const RATE_LIMIT_WAIT_MS = 60_000
const MAX_RATE_LIMIT_RETRIES = 5

const EMPTY_STATE: VerificationState = {
  status: 'idle', queue: [], position: 0, conflicts: [], failures: [], finishedAt: null, kept: {},
}

function storageKey(owner: CollectionOwner) {
  return `spindex-discogs-verification-${owner}`
}

function loadState(owner: CollectionOwner): VerificationState {
  try {
    const stored = window.localStorage.getItem(storageKey(owner))
    return stored ? { ...EMPTY_STATE, ...JSON.parse(stored) as Partial<VerificationState> } : EMPTY_STATE
  } catch {
    return EMPTY_STATE
  }
}

function discogsValue(release: DiscogsRelease, field: UpdatableField | KeyField): string | number | null {
  switch (field) {
    case 'title': return release.releaseTitle
    case 'record_label': return release.label[0] ?? null
    case 'record_type': return release.recordType
    case 'record_size': return release.recordSize
    case 'genre': return release.genre
    case 'sub_genre': return release.subGenre
    case 'image_url': return release.coverImage
    case 'catalog_number': return release.catalogNumber
    case 'artist': return release.artist
    case 'year_pressed': return release.year
    case 'country_pressed': return release.country
  }
}

function isEmpty(value: unknown) {
  return value === null || value === undefined || String(value).trim() === ''
}

/** Accent/case-insensitive; drops Discogs disambiguation like "(2)" and "*". */
function normalizeArtist(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\(\d+\)/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function normalizeKey(field: KeyField, value: string | number) {
  const text = String(value)
  if (field === 'artist') return normalizeArtist(text)
  if (field === 'catalog_number') return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return text.trim().toLowerCase()
}

export function diffRecord(record: VinylRecord, release: DiscogsRelease, kept: Record<string, string>) {
  const fields: FieldDiff<UpdatableField>[] = []
  for (const key of UPDATABLE_FIELDS) {
    const discogs = discogsValue(release, key)
    const current = (record[key] ?? null) as string | number | null
    if (isEmpty(discogs) || kept[`${record.id}:${key}`] === String(discogs)) continue
    // Cover URLs change format over time; only flag a missing cover.
    if (key === 'image_url' && !isEmpty(current)) continue
    if (String(current ?? '').trim() !== String(discogs).trim()) fields.push({ key, current, discogs: discogs! })
  }

  const keyMismatches: FieldDiff<KeyField>[] = []
  for (const key of KEY_FIELDS) {
    const discogs = discogsValue(release, key)
    const current = (record[key] ?? null) as string | number | null
    if (isEmpty(discogs) || isEmpty(current) || kept[`${record.id}:${key}`] === String(discogs)) continue
    if (normalizeKey(key, current!) !== normalizeKey(key, discogs!)) keyMismatches.push({ key, current, discogs: discogs! })
  }

  return { fields, keyMismatches }
}

export function recordReleaseId(record: Pick<VinylRecord, 'discogs_link' | 'image_url'>) {
  return getDiscogsReleaseId(record.discogs_link) ?? getDiscogsReleaseId(record.image_url)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Background Discogs verification. Lives at the admin page level so it keeps running while the
 * admin works; progress is saved locally, so a reload resumes where it stopped.
 */
export function useDiscogsVerification(owner: CollectionOwner) {
  const [state, setState] = useState<VerificationState>(() => loadState(owner))
  const stateRef = useRef(state)

  const update = useCallback((change: (current: VerificationState) => VerificationState) => {
    const next = change(stateRef.current)
    stateRef.current = next
    setState(next)
    try {
      window.localStorage.setItem(storageKey(owner), JSON.stringify(next))
    } catch (error) {
      console.error('Could not save the Discogs verification progress:', error)
    }
  }, [owner])

  useEffect(() => {
    if (state.status !== 'running') return
    let cancelled = false

    async function run() {
      const { data, error } = await supabase.from('vinyl_records').select(VERIFICATION_COLUMNS).eq('collection_owner', owner)
      if (cancelled) return
      if (error) {
        console.error('Discogs verification could not load records:', error)
        update((current) => ({ ...current, status: 'done', finishedAt: new Date().toISOString() }))
        return
      }
      const records = new Map(((data ?? []) as VinylRecord[]).map((record) => [record.id, record]))

      let rateLimitRetries = 0
      while (!cancelled && stateRef.current.position < stateRef.current.queue.length) {
        const record = records.get(stateRef.current.queue[stateRef.current.position])
        const releaseId = record ? recordReleaseId(record) : null
        let conflict: DiscogsConflict | null = null
        let failure: VerificationFailure | null = null

        if (record && releaseId) {
          const startedAt = Date.now()
          try {
            const [release] = await searchDiscogsReleases('', '', `https://www.discogs.com/release/${releaseId}`)
            if (!release) throw new Error('NO_DATA')

            const { fields, keyMismatches } = diffRecord(record, release, stateRef.current.kept)
            if (fields.length || keyMismatches.length) {
              conflict = {
                recordId: record.id, artist: record.artist, title: record.title, catalogNumber: record.catalog_number ?? null,
                release, fields, keyMismatches,
              }
            }
          } catch (lookupError) {
            const message = lookupError instanceof Error ? lookupError.message : String(lookupError)
            if (/\b429\b/.test(message) && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
              rateLimitRetries += 1
              await wait(RATE_LIMIT_WAIT_MS)
              continue
            }
            failure = { recordId: record.id, artist: record.artist, title: record.title, error: message }
          }
          await wait(Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - startedAt)))
          if (cancelled) return
        }

        rateLimitRetries = 0
        update((current) => ({
          ...current,
          position: current.position + 1,
          conflicts: conflict ? [...current.conflicts, conflict] : current.conflicts,
          failures: failure ? [...current.failures, failure] : current.failures,
        }))
      }

      if (!cancelled) update((current) => ({ ...current, status: 'done', finishedAt: new Date().toISOString() }))
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [state.status, owner, update])

  const start = useCallback(async () => {
    const { data, error } = await supabase.from('vinyl_records').select('id, discogs_link, image_url').eq('collection_owner', owner)
    if (error) throw new Error(error.message)
    const queue = ((data ?? []) as VinylRecord[]).filter((record) => recordReleaseId(record) !== null).map((record) => record.id)
    update((current) => ({ ...EMPTY_STATE, kept: current.kept, status: 'running', queue }))
  }, [owner, update])

  // Stops early; conflicts found so far stay available.
  const stop = useCallback(() => {
    update((current) => ({ ...current, status: 'done', finishedAt: new Date().toISOString() }))
  }, [update])

  /** Removes a reviewed conflict and remembers the Discogs values the admin chose not to apply. */
  const resolve = useCallback((recordId: string, keptValues: { key: string; discogs: string | number }[]) => {
    update((current) => ({
      ...current,
      conflicts: current.conflicts.filter((conflict) => conflict.recordId !== recordId),
      kept: {
        ...current.kept,
        ...Object.fromEntries(keptValues.map(({ key, discogs }) => [`${recordId}:${key}`, String(discogs)])),
      },
    }))
  }, [update])

  return { ...state, start, stop, resolve }
}
