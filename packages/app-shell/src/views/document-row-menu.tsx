import { Menu, MenuContent, MenuItem, MenuTrigger, useToast } from '@obiter/ui'
import { DotsThree, PencilSimple } from '@obiter/ui/icons'
import { useState } from 'react'
import { DocumentNameDialog } from '../document-name-dialog'
import {
  documentDisplayName,
  documentRenameErrorMessage,
  useRenameDocument,
  type MatterDocumentRecord,
} from '../documents'

export function DocumentRowMenu({
  document,
}: {
  document: MatterDocumentRecord
}) {
  const name = documentDisplayName(document)
  const rename = useRenameDocument()
  const { toast } = useToast()
  const [renaming, setRenaming] = useState(false)
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label={`Actions for ${name}`}
              className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <DotsThree size={16} aria-hidden />
            </button>
          }
        />
        <MenuContent aria-label={`Actions for ${name}`}>
          <MenuItem onClick={() => setRenaming(true)}>
            <PencilSimple size={15} aria-hidden className="text-subtle" />
            Rename…
          </MenuItem>
        </MenuContent>
      </Menu>
      <DocumentNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename document"
        description="The new name shows wherever this document appears. Versions and their history are unchanged."
        submitLabel="Rename"
        initialName={document.name ?? name}
        extension={document.currentVersion?.fileType}
        onSubmit={async (next) => {
          if (next === document.name) return
          try {
            await rename.mutateAsync({
              documentId: document.id,
              matterId: document.matterId,
              name: next,
            })
          } catch (cause) {
            throw new Error(documentRenameErrorMessage(cause))
          }
          toast({ title: 'Document renamed', description: next })
        }}
      />
    </>
  )
}
