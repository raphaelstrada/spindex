import { useAuth } from '@/lib/auth'

export const COLLECTION_OWNERS = ['Raphael', 'Tim', 'Aaron'] as const

export type CollectionOwner = (typeof COLLECTION_OWNERS)[number]

export function isCollectionOwner(value: unknown): value is CollectionOwner {
  return COLLECTION_OWNERS.includes(value as CollectionOwner)
}

/** Resolves a URL segment such as `aaron` to its owner, ignoring case. */
export function ownerFromSlug(slug: string | undefined): CollectionOwner | null {
  return COLLECTION_OWNERS.find((owner) => owner.toLowerCase() === slug?.toLowerCase()) ?? null
}

/**
 * Returns the collection owner of the logged-in admin (from the `admins` table).
 * Only usable under `RequireAdmin`.
 */
export function useCollectionOwner(): CollectionOwner {
  const { owner } = useAuth()
  if (!owner) throw new Error('useCollectionOwner must be used inside RequireAdmin')
  return owner
}
