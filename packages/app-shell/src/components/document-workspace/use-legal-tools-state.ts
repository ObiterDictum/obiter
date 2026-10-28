import { useState } from 'react'

import {
  readCitationStyle,
  writeCitationStyle,
  type CitationStyle,
} from '../../document-preferences'

/**
 * The References ribbon's legal-tool state: the persisted citation style. The
 * legal-checks panel's own open state lives with the other docked panels.
 */
export function useLegalToolsState(documentId: string) {
  const [citationStyle, setCitationStyle] = useState<CitationStyle>(() =>
    readCitationStyle(window.localStorage, documentId),
  )
  return {
    citationStyle,
    onCitationStyle: (style: CitationStyle) => {
      writeCitationStyle(window.localStorage, documentId, style)
      setCitationStyle(style)
    },
  }
}
