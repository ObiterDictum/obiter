import type { DocumentPresence } from '@obiter/contracts'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  tabSaveState,
  type SaveStateLabel,
} from './components/document-workspace/document-save-state'
import type { SaveState } from './components/document-workspace/use-document-save'

export interface DocumentTabStatus {
  save: SaveStateLabel
  trackChanges: boolean
  participants: readonly DocumentPresence[]
  presenceNames: ReadonlyMap<string, string>
  currentUserId?: string
}

type Statuses = Readonly<Record<string, DocumentTabStatus>>
type Publish = (documentId: string, status: DocumentTabStatus | null) => void

const NO_STATUSES: Statuses = {}
const StatusesContext = createContext<Statuses>(NO_STATUSES)
const PublishContext = createContext<Publish | null>(null)

export function DocumentTabStatusProvider({
  children,
}: {
  children: ReactNode
}) {
  const [statuses, setStatuses] = useState<Statuses>(NO_STATUSES)
  const [publish] = useState<Publish>(
    () => (documentId: string, status: DocumentTabStatus | null) => {
      setStatuses((current: Statuses) =>
        publishStatus(current, documentId, status),
      )
    },
  )
  return (
    <PublishContext.Provider value={publish}>
      <StatusesContext.Provider value={statuses}>
        {children}
      </StatusesContext.Provider>
    </PublishContext.Provider>
  )
}

function publishStatus(
  current: Statuses,
  documentId: string,
  status: DocumentTabStatus | null,
) {
  const existing = current[documentId] ?? null
  if (existing === status) return current
  if (status === null) {
    if (!existing) return current
    return Object.fromEntries(
      Object.entries(current).filter(([id]) => id !== documentId),
    )
  }
  return { ...current, [documentId]: status }
}

export function useDocumentTabStatuses(): Statuses {
  return useContext(StatusesContext)
}

export function useDocumentTabStatus(
  documentId: string | null,
): DocumentTabStatus | null {
  const statuses = useContext(StatusesContext)
  return documentId === null ? null : (statuses[documentId] ?? null)
}

export function usePublishDocumentTabStatus({
  documentId,
  status,
  versionLabel,
  offline,
  remoteChange,
  trackChanges,
  participants,
  presenceNames,
  currentUserId,
}: {
  documentId: string
  status: SaveState['status']
  versionLabel: string
  offline: boolean
  remoteChange: boolean
  trackChanges: boolean
  participants: readonly DocumentPresence[]
  presenceNames: ReadonlyMap<string, string>
  currentUserId?: string
}) {
  const publish = useContext(PublishContext)
  const save = useMemo(
    () => tabSaveState({ status, versionLabel, offline, remoteChange }),
    [status, versionLabel, offline, remoteChange],
  )
  const value = useMemo(
    () => ({ save, trackChanges, participants, presenceNames, currentUserId }),
    [save, trackChanges, participants, presenceNames, currentUserId],
  )
  useEffect(() => {
    if (!publish) return
    publish(documentId, value)
    return () => publish(documentId, null)
  }, [publish, documentId, value])
}
