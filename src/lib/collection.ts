export type CollectionOwner = 'Raphael' | 'Tim'

/**
 * Returns the collection owner based on the current URL.
 * The Tim collection is only visible when the path contains `/spindex/tim`.
 */
export function getCollectionOwner(): CollectionOwner {
  return window.location.pathname.toLowerCase().includes('/spindex/tim') ? 'Tim' : 'Raphael'
}
