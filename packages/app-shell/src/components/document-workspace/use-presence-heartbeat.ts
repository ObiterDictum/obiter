import type { DocumentCursor } from '@obiter/contracts'
import { useEffect, useRef } from 'react'
import { usePresenceUpdate } from '../../document-workspace-api'

const HEARTBEAT_MS = 8_000

/**
 * Heartbeat presence to the shared registry. Timer sync, not data fetching.
 * `clientId` is a per-tab nonce: two tabs of one account are distinct
 * participants, and a tab closing removes only its own heartbeat row.
 */
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
  const clientIdRef = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!enabled) return
    const clientId = clientIdRef.current
    mutateRef.current({ cursor: cursorRef.current, clientId })
    const timer = window.setInterval(() => {
      mutateRef.current({ cursor: cursorRef.current, clientId })
    }, HEARTBEAT_MS)
    return () => {
      window.clearInterval(timer)
      mutateRef.current({ cursor: null, clientId })
    }
  }, [documentId, enabled])
}
