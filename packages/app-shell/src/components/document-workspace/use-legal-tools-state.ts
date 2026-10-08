import { useState } from 'react'

import {
  readCitationStyle,
  writeCitationStyle,
  type CitationStyle,
} from '../../document-preferences'
import type { LegalChecksFocus } from './ribbon-review'

/**
 * The References ribbon's legal-tool state: the persisted citation style and
 * which legal-checks section the panel is focused on (its open state is the
 * focus itself — the same control toggles a section open and closed).
 */
export function useLegalToolsState(documentId: string) {
  const [focus, setFocus] = useState<LegalChecksFocus | null>(null)
  const [citationStyle, setCitationStyle] = useState<CitationStyle>(() =>
    readCitationStyle(window.localStorage, documentId),
  )
  return {
    citationStyle,
    onCitationStyle: (style: CitationStyle) => {
      writeCitationStyle(window.localStorage, documentId, style)
      setCitationStyle(style)
    },
    legalChecksOpen: focus,
    legalChecks: {
      open: focus,
      onOpen: (next: LegalChecksFocus) =>
        setFocus((current) => (current === next ? null : next)),
    },
  }
}
