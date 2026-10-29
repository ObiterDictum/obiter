import { useState } from 'react'
import {
  browserPrint,
  requestDocumentPrint,
  type DocumentPrintOutcome,
} from '../../document-print'

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
