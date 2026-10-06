export type CollectionOwner = 'Raphael' | 'Tim'

/**
 * Returns the collection owner based on the current URL.
 * The Tim collection is only visible when the URL hash contains `#/tim`
 * (e.g. /spindex/#/tim), which works on static hosting without rewrites.
 */
export function getCollectionOwner(): CollectionOwner {
  const url = `${window.location.pathname}${window.location.hash}`.toLowerCase()
  return url.includes('/tim') ? 'Tim' : 'Raphael'
}
