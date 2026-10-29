import { useState } from 'react'
import {
  clearPendingCitation,
  readPendingCitation,
} from '../../pending-citation'
import { withCaretRefocus } from './document-actions'

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
