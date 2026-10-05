import type { DocumentCursor } from '@obiter/contracts'
import { useEffect, useRef } from 'react'
import { usePresenceUpdate } from '../../document-workspace-api'

const HEARTBEAT_MS = 8_000

/** Heartbeat presence to the ephemeral registry. Timer sync, not data fetching. */
export function useDocumentPresenceHeartbeat(
  documentId: string,
  cursor: DocumentCursor | null,
  enabled: boolean,
) {
  const update = usePresenceUpdate(documentId)
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const mutateRef = useRef(update.mutate)
  mutateRef.current = update.mutate

  useEffect(() => {
    if (!enabled) return
    mutateRef.current({ cursor: cursorRef.current })
    const timer = window.setInterval(() => {
      mutateRef.current({ cursor: cursorRef.current })
    }, HEARTBEAT_MS)
    return () => {
      window.clearInterval(timer)
      mutateRef.current({ cursor: null })
    }
  }, [documentId, enabled])
}
