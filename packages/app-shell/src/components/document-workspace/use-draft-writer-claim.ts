import { useEffect } from 'react'

import {
  releaseDocumentDraftWriterClaim,
  touchDocumentDraftWriterClaim,
} from '../../document-draft-store'
import { draftStorage } from './document-draft-storage'

type DraftWriterStorage = NonNullable<ReturnType<typeof draftStorage>>

/**
 * Holds this tab's writer claim open while it owns a draft: touching it on an
 * interval and releasing it on page hide. A stale claim is how another tab may
 * take the draft over, so the release must always run.
 */
export function useDraftWriterClaim({
  storage,
  documentId,
  writerId,
  instanceId,
}: {
  storage: DraftWriterStorage | null
  documentId: string
  writerId: () => string
  instanceId: string
}) {
  useEffect(() => {
    if (!storage) return
    const id = writerId()
    const tick = () => touchDocumentDraftWriterClaim(storage, id, instanceId)
    tick()
    const timer = window.setInterval(tick, 1000)
    const release = () =>
      releaseDocumentDraftWriterClaim(storage, id, instanceId)
    window.addEventListener('pagehide', release)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [storage, documentId, writerId, instanceId])
}
