import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * One owner for "the editor has unsaved work", so the verification panel and
 * the workspace cannot disagree. `DocxWorkspace` publishes the boolean it
 * already computes with `isDraftDirty`; the panel reads it. The draft state
 * itself stays owned by `useWorkspaceDrafts`; this is a status notification,
 * not a second copy of the drafts.
 */
type DocumentDraftStatus = {
  dirty: boolean
  setDirty: (dirty: boolean) => void
}

const DocumentDraftStatusContext = createContext<DocumentDraftStatus | null>(
  null,
)

export function DocumentDraftStatusProvider({
  children,
}: {
  children: ReactNode
}) {
  const [dirty, setDirty] = useState(false)
  const value = useMemo(() => ({ dirty, setDirty }), [dirty])
  return (
    <DocumentDraftStatusContext.Provider value={value}>
      {children}
    </DocumentDraftStatusContext.Provider>
  )
}

/** The published dirty state, or null outside a document workspace. */
export function useDocumentDraftStatus() {
  return useContext(DocumentDraftStatusContext)
}

/**
 * Publish the workspace's dirty state for the lifetime of the workspace.
 * Unmounting clears it, so a stale "dirty" cannot outlive the editor that
 * reported it.
 */
export function usePublishDocumentDirty(dirty: boolean) {
  const status = useDocumentDraftStatus()
  const setDirty = status?.setDirty
  useEffect(() => {
    if (!setDirty) return
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
}
