import { useAuth } from '@/lib/auth'

export type CollectionOwner = 'Raphael' | 'Tim'

/**
 * Returns the collection owner of the logged-in admin (from the `admins` table).
 * Only usable under `RequireAdmin`.
 */
export function useCollectionOwner(): CollectionOwner {
  const { owner } = useAuth()
  if (!owner) throw new Error('useCollectionOwner must be used inside RequireAdmin')
  return owner
}
