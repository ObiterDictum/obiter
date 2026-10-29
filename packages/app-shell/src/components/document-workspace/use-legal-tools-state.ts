import { useState } from 'react'

import {
  readCitationStyle,
  writeCitationStyle,
  type CitationStyle,
} from '../../document-preferences'

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
