import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@obiter/ui'
import { useDocumentModel } from '../../document-workspace-queries'
import type { RecoverableDraft } from '../../document-draft-store'
import {
  parkedDraftClipboardText,
  type ParkedDraftReview,
} from '../../document-parked-draft'
import type { ChromeDrafts } from './use-workspace-drafts'

export function ParkedDraftsDialog({
  drafts,
  items,
}: {
  drafts: ChromeDrafts
  items: RecoverableDraft[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            Review unsaved changes
          </Button>
        }
      />
      <DialogContent>
        <DialogCloseButton />
        <DialogTitle>Unsaved changes from an earlier version</DialogTitle>
        <DialogDescription>
          These edits were recorded against an earlier version of this document.
          Nothing is applied until you choose it. Edits whose paragraph changed
          since are marked “Changed by someone else”.
        </DialogDescription>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {items.map((item) => (
            <ParkedDraftReview
              key={item.draftId}
              draft={item}
              drafts={drafts}
            />
          ))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ParkedDraftReview({
  draft,
  drafts,
}: {
  draft: RecoverableDraft
  drafts: ChromeDrafts
}) {
  const baseQuery = useDocumentModel(drafts.documentId, {
    versionId: draft.baseVersionId,
  })
  const baseModel = baseQuery.data?.model
  const review =
    baseModel !== undefined
      ? drafts.reviewParkedDraft(draft.draftId, baseModel)
      : undefined
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function copyAll() {
    if (!review) return
    try {
      await navigator.clipboard.writeText(parkedDraftClipboardText(review))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  function apply() {
    if (!baseModel) return
    const result = drafts.applyParkedDraft(draft.draftId, baseModel)
    if (!result) return
    setNotice(
      result.applied > 0
        ? `${String(result.applied)} change(s) restored as drafts. Save the document to keep them.`
        : 'No parked edits could be applied safely.',
    )
  }

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          Draft from {formatStamp(draft.updatedAt)}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!review}
            onClick={() => void copyAll()}
          >
            {copied ? 'Copied' : 'Copy all to clipboard'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!review || review.appliableCount === 0}
            onClick={apply}
          >
            Apply to current version
          </Button>
        </div>
      </header>
      {baseQuery.isLoading ? (
        <p className="text-sm text-muted">Loading parked changes…</p>
      ) : baseQuery.isError || review === undefined ? (
        <p className="text-sm text-muted">
          The earlier version could not be loaded, so these edits cannot be
          reviewed safely. They can still be discarded from the banner.
        </p>
      ) : review.edits.length === 0 && review.otherCount === 0 ? (
        <p className="text-sm text-muted">This draft holds no editable text.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {review.edits.map((edit) => (
            <li
              key={edit.key}
              className="rounded-md bg-raised px-3 py-2 text-sm"
            >
              <p className="text-ink">
                {edit.kind === 'insert'
                  ? `New paragraph after “${edit.paragraphLabel || 'untitled'}”`
                  : edit.kind === 'delete'
                    ? `Delete “${edit.paragraphLabel || 'untitled'}”`
                    : `Edit in “${edit.paragraphLabel || 'untitled'}”`}
                {edit.status === 'changed' ? (
                  <span className="ml-2 text-warning">
                    Changed by someone else
                  </span>
                ) : null}
              </p>
              {edit.kind === 'text' ? (
                <p className="mt-1 text-muted">
                  <span className="line-through">{edit.oldText}</span>
                  {' → '}
                  {edit.newText}
                </p>
              ) : edit.kind === 'delete' ? (
                <p className="mt-1 text-muted">{edit.oldText}</p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-muted">
                  {edit.newText}
                </p>
              )}
            </li>
          ))}
          {review.otherCount > 0 ? (
            <li className="text-sm text-muted">
              {String(review.otherCount)} other parked change(s) (formatting or
              structure) are not shown here but are included in Copy all.
            </li>
          ) : null}
        </ul>
      )}
      {notice ? (
        <p className="text-sm text-ink" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  )
}

function formatStamp(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 'an earlier session'
  return new Date(parsed).toLocaleString()
}
