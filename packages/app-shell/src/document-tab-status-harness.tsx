import { DocumentTabSaveIndicator } from './document-tab-save-indicator'
import { useDocumentTabStatus } from './document-tab-status'

export function TabSaveStateProbe({ documentId }: { documentId: string }) {
  const status = useDocumentTabStatus(documentId)
  return <DocumentTabSaveIndicator state={status?.save ?? null} />
}
