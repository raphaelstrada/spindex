import { useEffect } from 'react'

// A deterrent only: public_catalog stays readable through the anon key, so this cannot hide the data.
const PROTECTED_CLASS = 'content-protected'

const DEVTOOLS_KEYS = ['KeyI', 'KeyJ', 'KeyC']
const PAGE_KEYS = ['KeyU', 'KeyS', 'KeyP']
const SELECTION_KEYS = ['KeyA', 'KeyC', 'KeyX']

function isEditable(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]') !== null
}

function isBlockedShortcut(event: KeyboardEvent) {
  if (event.key === 'F12') return true
  const modifier = event.ctrlKey || event.metaKey
  if (!modifier) return false
  if ((event.shiftKey || event.altKey) && DEVTOOLS_KEYS.includes(event.code)) return true
  if (PAGE_KEYS.includes(event.code)) return true
  return SELECTION_KEYS.includes(event.code) && !isEditable(event.target)
}

/** Discourages copying while the storefront is on screen. Search fields keep working. */
export function useContentProtection() {
  useEffect(() => {
    const blockOutsideFields = (event: Event) => {
      if (!isEditable(event.target)) event.preventDefault()
    }
    const blockShortcuts = (event: KeyboardEvent) => {
      if (isBlockedShortcut(event)) event.preventDefault()
    }
    const events = ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart']

    document.documentElement.classList.add(PROTECTED_CLASS)
    events.forEach((name) => document.addEventListener(name, blockOutsideFields))
    document.addEventListener('keydown', blockShortcuts)
    return () => {
      document.documentElement.classList.remove(PROTECTED_CLASS)
      events.forEach((name) => document.removeEventListener(name, blockOutsideFields))
      document.removeEventListener('keydown', blockShortcuts)
    }
  }, [])
}
