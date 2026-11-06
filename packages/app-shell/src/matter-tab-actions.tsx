import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  useToast,
} from '@obiter/ui'
import { ApiError } from './api'
import { useCurrentUser } from './current-user'
import { useDeleteDocument } from './documents'
import { ErrorNotice } from './views/settings-fields'

export function useCanManageDocuments(): boolean {
  const { data: me } = useCurrentUser()
  return me?.user.role === 'owner' || me?.user.role === 'admin'
}

export function DeleteDocumentDialog({
  documentId,
  matterId,
  onClose,
  onDeleted,
}: {
  documentId: string
  matterId: string
  onClose: () => void
  onDeleted: () => void
}) {
  const { toast } = useToast()
  const deleteDocument = useDeleteDocument()
  const [actionError, setActionError] = useState<string | null>(null)
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next) return
        setActionError(null)
        onClose()
      }}
    >
      <DialogContent size="md">
        <DialogTitle>Delete document</DialogTitle>
        <DialogDescription>
          Deleting this document also removes its redaction runs. Removals are
          soft — rows persist for audit and can be restored by an operator.
        </DialogDescription>
        {actionError ? <ErrorNotice message={actionError} /> : null}
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            variant="danger"
            loading={deleteDocument.isPending}
            onClick={async () => {
              setActionError(null)
              try {
                await deleteDocument.mutateAsync({ documentId, matterId })
              } catch (cause) {
                setActionError(
                  cause instanceof ApiError
                    ? cause.message
                    : 'The document could not be deleted. Try again.',
                )
                return
              }
              toast({ title: 'Document deleted' })
              onDeleted()
            }}
          >
            Delete document
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
