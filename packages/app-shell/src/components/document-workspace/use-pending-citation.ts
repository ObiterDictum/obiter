import { useState } from 'react'
import {
  clearPendingCitation,
  readPendingCitation,
} from '../../pending-citation'
import { withCaretRefocus } from './document-actions'

/**
 * The citation a source page left for this document, and the two answers it
 * takes: insert it at the caret, or discard it. The request is read once when
 * the workspace mounts — the workspace is the lifecycle boundary for one
 * document, so a switch cannot carry it — and dropped as soon as it is
 * answered, so the bar cannot come back for a request that is done.
 *
 * `insert` is the workspace's own insertion, so the citation style and the
 * tracked-change behaviour are the document's rather than a second path. Both
 * answers leave the document's focus, so both hand the caret back, as the
 * ribbon's controls do.
 */
export function usePendingCitation(
  documentId: string,
  insert: (citation: string) => void,
) {
  const [request, setRequest] = useState(() => readPendingCitation(documentId))
  const text = request?.documentId === documentId ? request.text : null
  const answer = () => {
    clearPendingCitation(documentId)
    setRequest(null)
  }
  return {
    text,
    insertCitation: withCaretRefocus(() => {
      if (text === null) return
      insert(text)
      answer()
    }),
    cancelCitation: withCaretRefocus(answer),
  }
}
