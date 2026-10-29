import { FileArrowUp, Plus, Upload } from '@phosphor-icons/react'
import { buttonClassName, cn, useToast } from '@obiter/ui'
import { useState, type DragEvent, type ReactNode } from 'react'
import { blankDocumentFile } from '../document-blank'
import { useUploadMatterDocument } from '../documents'

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

export function MatterDropZone({
  matterId,
  children,
}: {
  matterId: string
  children: ReactNode
}) {
  const { pending, send } = useMatterDocumentUpload(matterId)
  const [dragging, setDragging] = useState(false)

  function carriesFiles(event: DragEvent) {
    return event.dataTransfer.types.includes('Files')
  }

  return (
    <div
      className="relative"
      aria-busy={pending || undefined}
      onDragEnter={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        setDragging(false)
        const file = event.dataTransfer.files?.[0]
        if (file) send(file)
      }}
    >
      {children}
      {dragging ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 z-10 grid place-items-center',
            'rounded-lg border-2 border-dashed border-brand bg-brand-soft',
          )}
        >
          <span className="flex items-center gap-2 rounded-md bg-surface px-4 py-2 text-item text-ink shadow-sm">
            <FileArrowUp size={16} aria-hidden />
            Drop to upload to this matter
          </span>
        </div>
      ) : null}
    </div>
  )
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
