import { PX_PER_INCH } from './document-page-units'

/**
 * Printing is the browser's or Electron's own print dialog over the pages the
 * workspace has already painted. It is never a server round-trip: the painted
 * pages carry the unsaved drafts, pending inserts, deletions and tracked-change
 * marks the user can see, so the printed sheet matches the screen. Nothing here
 * saves, mutates or clears a draft.
 */
export type DocumentPrintOutcome =
  | { status: 'printed' }
  | { status: 'unsupported' }
  | { status: 'failed'; message: string }

/**
 * The platform print entry point, or undefined where none exists (a test
 * environment, an embedded webview without print). Callers surface the absent
 * case rather than silently doing nothing.
 */
export function browserPrint(): (() => void) | undefined {
  if (typeof window === 'undefined' || typeof window.print !== 'function') {
    return undefined
  }
  return window.print.bind(window)
}

export function requestDocumentPrint(
  print: (() => void) | undefined,
): DocumentPrintOutcome {
  if (!print) return { status: 'unsupported' }
  try {
    print()
    return { status: 'printed' }
  } catch (error) {
    return {
      status: 'failed',
      message:
        error instanceof Error && error.message.length > 0
          ? error.message
          : 'Printing failed.',
    }
  }
}

/**
 * The `@page` rule that makes one painted sheet one sheet of paper. The page
 * engine has already paginated the document, so the paper must be the
 * document's own page box (from its section properties), not an assumed A4:
 * a Letter document printed on assumed A4 would reflow or clip.
 */
export function documentPrintPageRule(box: {
  widthPx: number
  heightPx: number
}): string {
  return `@page{size:${inches(box.widthPx)}in ${inches(box.heightPx)}in;margin:0}`
}

function inches(px: number): number {
  return Number((px / PX_PER_INCH).toFixed(4))
}
