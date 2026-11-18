import { useToast } from '@obiter/ui'
import { PencilSimple } from '@obiter/ui/icons'
import {
  checkDocumentName,
  DOCUMENT_NAME_MAX_LENGTH,
} from '@obiter/contracts/document-name-rules'
import { useRef, useState, type FormEvent } from 'react'
import {
  documentDisplayName,
  documentRenameErrorMessage,
  useRenameDocument,
  type MatterDocumentRecord,
} from '../../documents'
import { formatShortcut, shortcutAttribute } from '../../keyboard-platform'

export function DocumentTitle({
  document,
}: {
  document: MatterDocumentRecord
}) {
  const name = documentDisplayName(document)
  const rename = useRenameDocument()
  const { toast } = useToast()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const errorId = `document-title-error-${document.id}`
  const titleRef = useRef<HTMLButtonElement>(null)

  const stem = document.name ?? name
  const extension = document.currentVersion?.fileType

  function startEditing() {
    setDraft(stem)
    setError(null)
  }

  function cancel() {
    setDraft(null)
    setError(null)
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (draft === null || rename.isPending) return
    const checked = checkDocumentName(draft, extension)
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    if (checked.name === stem) {
      cancel()
      return
    }
    try {
      await rename.mutateAsync({
        documentId: document.id,
        matterId: document.matterId,
        name: checked.name,
      })
    } catch (cause) {
      setError(documentRenameErrorMessage(cause))
      return
    }
    cancel()
    toast({ title: 'Document renamed', description: checked.name })
  }

  if (draft === null) {
    return (
      <h1 className="flex min-h-9 min-w-0 items-center px-3 text-item text-ink">
        <button
          ref={titleRef}
          type="button"
          className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-item text-ink hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-keyshortcuts={shortcutAttribute(['F2'])}
          title={`Rename (${formatShortcut(['F2'])})`}
          onClick={startEditing}
          onKeyDown={(event) => {
            if (event.key !== 'F2') return
            event.preventDefault()
            startEditing()
          }}
        >
          <span className="min-w-0 truncate">{name}</span>
          <PencilSimple
            size={13}
            aria-hidden
            className="shrink-0 text-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
      </h1>
    )
  }

  return (
    <form
      noValidate
      className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-3"
      onSubmit={(event) => void save(event)}
    >
      <span className="flex w-full max-w-md min-w-0 items-center gap-2">
        <input
          aria-label="Document name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoFocus
          value={draft}
          maxLength={
            DOCUMENT_NAME_MAX_LENGTH + (extension ? extension.length + 1 : 0)
          }
          readOnly={rename.isPending}
          spellCheck={false}
          autoComplete="off"
          className={`h-7 min-w-0 flex-1 rounded-md border bg-raised px-2 text-item text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${error ? 'border-danger' : 'border-line'}`}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            cancel()
          }}
        />
        {extension ? (
          <span className="shrink-0 text-item text-subtle">.{extension}</span>
        ) : null}
      </span>
      {error ? (
        <p id={errorId} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : (
        <p className="text-caption text-subtle">
          Enter to save · Esc to cancel
        </p>
      )}
    </form>
  )
}
