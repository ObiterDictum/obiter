import type { DocumentCursor } from '@obiter/contracts'
import { useEffect, useRef } from 'react'
import { usePresenceUpdate } from '../../document-workspace-api'

const HEARTBEAT_MS = 8_000

export function useDocumentPresenceHeartbeat(
  documentId: string,
  cursor: DocumentCursor | null,
  model: { data?: { versionId: string } },
  sync: { data?: { currentVersionId?: string | null } },
) {
  const loaded = model.data?.versionId
  const current = sync.data?.currentVersionId
  const versionId =
    loaded && (!current || current === loaded) ? loaded : undefined
  const { mutate } = usePresenceUpdate()
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const clientIdRef = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!versionId) return
    const clientId = clientIdRef.current
    let controller: AbortController | undefined
    const heartbeat = () => {
      controller?.abort()
      controller = new AbortController()
      mutate({
        documentId,
        input: { cursor: cursorRef.current, clientId },
        signal: controller.signal,
      })
    }
    heartbeat()
    const timer = window.setInterval(heartbeat, HEARTBEAT_MS)
    return () => {
      window.clearInterval(timer)
      controller?.abort()
    }
  }, [documentId, versionId, mutate])
}
