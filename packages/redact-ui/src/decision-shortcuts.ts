import { useEffect, useEffectEvent } from 'react'
import { isTypingTarget } from '@obiter/app-shell'
import type { SpanDecision } from '@obiter/contracts'

export function useDecisionShortcuts(
  enabled: boolean,
  decide: (decision: SpanDecision) => void,
) {
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isTypingTarget(event.target) ||
      document.querySelector(
        'dialog[open], [role="dialog"]:not([data-closed]), [role="alertdialog"]:not([data-closed]), [role="menu"]:not([data-closed])',
      )
    )
      return

    const key = event.key.toLowerCase()
    if (event.target instanceof Element) {
      if (
        event.target.closest(
          '[contenteditable]:not([contenteditable="false" i])',
        )
      )
        return
      const span = event.target.closest('[data-span-id], [role="option"]')
      if (
        span &&
        !span.matches('[aria-selected="true"], [aria-pressed="true"]')
      )
        return
      if (
        !span &&
        key === 'enter' &&
        event.target.closest(
          'button, a[href], [role="button"], [role="tab"], [role="combobox"]',
        )
      )
        return
    }
    const decision =
      key === 'enter'
        ? 'accept'
        : key === 'r'
          ? 'reject'
          : key === 'p'
            ? 'pseudonymise'
            : null
    if (!decision) return
    event.preventDefault()
    decide(decision)
  })

  useEffect(() => {
    if (!enabled) return
    const handleKey = (event: KeyboardEvent) => onKey(event)
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [enabled])
}
