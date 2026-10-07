import { useEffect, useLayoutEffect } from 'react'

/**
 * `useLayoutEffect` in the browser, `useEffect` when server-rendering: the
 * workspace sits inside a TanStack Start route that SSRs, where a plain
 * useLayoutEffect never runs and only warns.
 *
 * Use this only for effects that must land inside the commit itself — a
 * keystroke dispatched while the caret's textarea is unmounted goes to
 * `document.body` and is silently lost, so the save-boundary swap has to
 * retarget and refocus before the browser can deliver the next event.
 */
export const useBrowserLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect
