import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type DocumentDraftStatus = {
  dirty: boolean
  setDirty: (dirty: boolean) => void
}

const DocumentDraftStatusContext = createContext<DocumentDraftStatus | null>(
  null,
)

export function DocumentDraftStatusProvider({
  children,
  onDirtyChange,
}: {
  children: ReactNode
  onDirtyChange?: () => void
}) {
  const [dirty, setDirtyState] = useState(false)
  const value = useMemo(
    () => ({
      dirty,
      setDirty: (next: boolean) => {
        setDirtyState(next)
        if (next) onDirtyChange?.()
      },
    }),
    [dirty, onDirtyChange],
  )
  return (
    <DocumentDraftStatusContext.Provider value={value}>
      {children}
    </DocumentDraftStatusContext.Provider>
  )
}

export function useDocumentDraftStatus() {
  return useContext(DocumentDraftStatusContext)
}

export function usePublishDocumentDirty(dirty: boolean) {
  const status = useDocumentDraftStatus()
  const setDirty = status?.setDirty
  useEffect(() => {
    if (!setDirty) return
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
}
