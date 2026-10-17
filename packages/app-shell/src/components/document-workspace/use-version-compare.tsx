import { useState } from 'react'
import { useDocument } from '../../documents'
import { VersionCompareDialog } from './version-compare-dialog'

/**
 * The editor's version-comparison control: the handler the Review ribbon's
 * Compare versions control calls, and the dialog it opens.
 *
 * The versions come from the same query the document detail page reads, so the
 * editor adds no fetch of its own. The handler is absent while fewer than two
 * stored versions are ready DOCX, which is what lets the ribbon gate the control
 * honestly rather than ship it dead. The comparison reads stored versions, so
 * unsaved editor changes are not part of it.
 */
export function useVersionCompare(documentId: string) {
  const document = useDocument(documentId)
  const [open, setOpen] = useState(false)
  const versions = document.data?.versions ?? []
  const comparable = versions.filter(
    (version) =>
      version.documentStatus === 'ready' && version.fileType === 'docx',
  )
  return {
    onCompareVersions: comparable.length >= 2 ? () => setOpen(true) : undefined,
    versionCompareDialog: (
      <VersionCompareDialog
        documentId={documentId}
        versions={versions}
        open={open}
        onOpenChange={setOpen}
      />
    ),
  }
}
