import { useSyncExternalStore } from 'react'

const query = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const list = window.matchMedia(query)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function snapshot() {
  return window.matchMedia(query).matches
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
