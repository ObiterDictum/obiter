import { useState } from 'react'
import {
  browserPrint,
  requestDocumentPrint,
  type DocumentPrintOutcome,
} from '../../document-print'

/**
 * Owns the print request and its banner. Printing the painted pages saves
 * nothing and clears no draft, so there is no document state to reconcile; the
 * only state here is whether the platform refused or lacks the dialog.
 */
export function useDocumentPrint() {
  const [printBanner, setPrintBanner] = useState<string | null>(null)

  function printDocument(): DocumentPrintOutcome {
    const outcome = requestDocumentPrint(browserPrint())
    setPrintBanner(
      outcome.status === 'unsupported'
        ? 'Printing is not available in this environment.'
        : outcome.status === 'failed'
          ? `Printing failed: ${outcome.message}`
          : null,
    )
    return outcome
  }

  return { printBanner, printDocument }
}
