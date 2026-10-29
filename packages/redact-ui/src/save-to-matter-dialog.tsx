import { useState } from 'react'
import { FolderOpen } from '@phosphor-icons/react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Select,
} from '@obiter/ui'
import { useMattersList } from '@obiter/app-shell'
import { useSaveToMatter } from './hooks'
import type { RedactionRun } from './types'

export function SaveToMatterDialog({
  run,
  onOpenDocument,
}: {
  run: RedactionRun
  onOpenDocument?: (target: { matterId: string; documentId: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [matterId, setMatterId] = useState('')
  const matters = useMattersList({ enabled: open })
  const save = useSaveToMatter(run.id)
  const saved = save.data
  const options = (matters.data ?? []).map((matter) => ({
    value: matter.id,
    label: matter.name,
  }))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) save.reset()
      }}
    >
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        iconStart={<FolderOpen size={16} aria-hidden="true" />}
      >
        Save to matter
      </Button>
      <DialogContent size="md">
        <DialogTitle>Save this copy to a matter</DialogTitle>
        <DialogDescription>
          The redacted copy becomes version 1 of a new document in the matter
          you choose. The source file stays where it is, and saving is recorded
          in the audit log.
        </DialogDescription>
        {saved ? (
          <div className="flex flex-col gap-3">
            <p
              className="rounded-lg bg-success-soft p-4 text-meta text-ink"
              role="status"
            >
              Saved as version {saved.versionNumber} of a new document in the
              matter.
            </p>
            <div className="flex justify-end gap-2">
              {onOpenDocument ? (
                <Button
                  variant="primary"
                  onClick={() => onOpenDocument(saved)}
                  iconStart={<FolderOpen size={16} aria-hidden="true" />}
                >
                  Open document
                </Button>
              ) : null}
              <DialogClose render={<Button variant="secondary">Done</Button>} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {matters.isPending ? (
              <p className="text-meta text-muted">Loading matters…</p>
            ) : matters.error ? (
              <p className="text-meta text-danger" role="alert">
                Matters are unavailable, so this copy cannot be saved yet.{' '}
                {matters.error.message}
              </p>
            ) : options.length === 0 ? (
              <p className="text-meta text-muted">
                You have no matter to save this copy into yet. Create one first.
              </p>
            ) : (
              <Select
                label="Matter"
                placeholder="Choose a matter"
                value={matterId}
                onValueChange={(value) => setMatterId(value ?? '')}
                options={options}
              />
            )}
            {save.error ? (
              <p className="text-meta text-danger" role="alert">
                The copy was not saved. {save.error.message}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <DialogClose render={<Button variant="ghost">Cancel</Button>} />
              <Button
                variant="primary"
                loading={save.isPending}
                disabled={!matterId || save.isPending}
                onClick={() => save.mutate(matterId)}
              >
                Save to matter
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
