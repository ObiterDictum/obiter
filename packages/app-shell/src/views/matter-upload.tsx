import { Plus, Upload } from '@phosphor-icons/react'
import { buttonClassName, useToast } from '@obiter/ui'
import { blankDocumentFile } from '../document-blank'
import { useUploadMatterDocument } from '../documents'

/**
 * The one upload path into a matter, shared by the list's preview and the
 * matter page. The document list is invalidated by the mutation, so the new
 * document appears in the table that asked for it.
 */
function useMatterDocumentUpload(matterId: string) {
  const upload = useUploadMatterDocument(matterId)
  const { toast } = useToast()

  function send(file: File) {
    upload.mutate(file, {
      onSuccess: (result) => {
        toast({
          title: 'Document uploaded',
          description: result.version.filename,
        })
      },
      onError: (error) => {
        toast({
          title: 'Upload failed',
          description: error.message,
          tone: 'danger',
        })
      },
    })
  }

  return { pending: upload.isPending, send }
}

export function MatterUploadButton({
  matterId,
  label = 'Upload',
  variant = 'secondary',
}: {
  matterId: string
  label?: string
  variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const { pending, send } = useMatterDocumentUpload(matterId)
  return (
    <label
      className={`${buttonClassName({ variant, size: 'md' })} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring`}
    >
      {pending ? (
        'Uploading…'
      ) : (
        <>
          <Upload size={16} aria-hidden /> {label}
        </>
      )}
      <input
        type="file"
        accept=".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        disabled={pending}
        aria-label="Upload document"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) send(file)
          event.target.value = ''
        }}
      />
    </label>
  )
}

/** "New document": a blank Word file, uploaded through the same path. */
export function NewDocumentButton({ matterId }: { matterId: string }) {
  const { pending, send } = useMatterDocumentUpload(matterId)
  const { toast } = useToast()
  return (
    <button
      type="button"
      className={buttonClassName({ variant: 'primary', size: 'md' })}
      disabled={pending}
      onClick={() => {
        void blankDocumentFile()
          .then(send)
          .catch((error: unknown) => {
            // Only the local OOXML build can fail here, before any upload.
            toast({
              title: 'Could not create the document',
              description:
                error instanceof Error ? error.message : 'Please try again.',
              tone: 'danger',
            })
          })
      }}
    >
      <Plus size={16} aria-hidden /> New document
    </button>
  )
}
