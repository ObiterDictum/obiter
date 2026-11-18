import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
} from '@obiter/ui'
import {
  checkDocumentName,
  DEFAULT_DOCUMENT_NAME,
  DOCUMENT_NAME_MAX_LENGTH,
} from '@obiter/contracts/document-name-rules'
import { useRef, useState, type FormEvent, type RefObject } from 'react'

export function DocumentNameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName,
  extension,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  submitLabel: string
  initialName: string
  extension?: string
  onSubmit: (name: string) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" initialFocus={inputRef}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DocumentNameForm
          inputRef={inputRef}
          initialName={initialName}
          extension={extension}
          submitLabel={submitLabel}
          onSubmit={async (name) => {
            await onSubmit(name)
            onOpenChange(false)
          }}
        />
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}

export function NewDocumentDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => Promise<void>
}) {
  return (
    <DocumentNameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New document"
      description="Name the Word document. You can rename it later."
      submitLabel="Create"
      initialName={DEFAULT_DOCUMENT_NAME}
      extension="docx"
      onSubmit={onCreate}
    />
  )
}

function DocumentNameForm({
  inputRef,
  initialName,
  extension,
  submitLabel,
  onSubmit,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  initialName: string
  extension?: string
  submitLabel: string
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checked = checkDocumentName(name, extension)
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    setError(null)
    setPending(true)
    try {
      await onSubmit(checked.name)
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'The name could not be saved. Try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <Input
        ref={inputRef}
        label="Name"
        value={name}
        maxLength={
          DOCUMENT_NAME_MAX_LENGTH + (extension ? extension.length + 1 : 0)
        }
        error={error}
        trailing={extension ? `.${extension}` : undefined}
        className={extension ? 'pr-14' : undefined}
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setName(event.target.value)
          if (error) setError(null)
        }}
      />
      <DialogFooter>
        <DialogClose
          render={
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          }
        />
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
