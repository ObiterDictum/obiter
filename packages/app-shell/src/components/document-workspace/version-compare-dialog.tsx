import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@obiter/ui'
import type { DocumentVersionRecord } from '../../documents'
import { DocumentVersionCompare } from './version-compare'

export function VersionCompareDialog({
  documentId,
  versions,
  open,
  onOpenChange,
}: {
  documentId: string
  versions: DocumentVersionRecord[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[80vh] overflow-y-auto">
        <DialogTitle>Compare stored versions</DialogTitle>
        <DialogDescription>
          Compare two stored DOCX versions. Unsaved editor changes are not
          included.
        </DialogDescription>
        <DocumentVersionCompare documentId={documentId} versions={versions} />
        <DialogClose render={<Button variant="ghost" size="sm" />}>
          Close
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
