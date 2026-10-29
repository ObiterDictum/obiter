import { PX_PER_INCH } from './document-page-units'

export type DocumentPrintOutcome =
  | { status: 'printed' }
  | { status: 'unsupported' }
  | { status: 'failed'; message: string }

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

export function documentPrintPageRule(box: {
  widthPx: number
  heightPx: number
}): string {
  return `@page{size:${inches(box.widthPx)}in ${inches(box.heightPx)}in;margin:0}`
}

function inches(px: number): number {
  return Number((px / PX_PER_INCH).toFixed(4))
}
