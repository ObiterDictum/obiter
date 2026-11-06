import {
  KeyboardHint,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  useToast,
} from '@obiter/ui'
import {
  CaretDown,
  FileText,
  PencilSimple,
  Plus,
  ShieldCheck,
  Upload,
} from '@obiter/ui/icons'
import { useRef, useState, type KeyboardEvent } from 'react'
import { blankDocumentFile } from './document-blank'
import { useMatterDocuments, useUploadMatterDocument } from './documents'
import {
  documentTab,
  redactTab,
  verifyTab,
  type MatterTab,
} from './matter-tabs'
import { useMatterTabs } from './matter-tabs-state'
import { useCreateMatterRedactionRun } from './redaction-runs'
import { useCreateVerificationRun } from './verification-runs'

export function MatterNewItemMenu() {
  const { matterId, tabs, activeId, openPermanent, goToTab } = useMatterTabs()
  const upload = useUploadMatterDocument(matterId)
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)

  const targetTab = activeDocumentTab(tabs, activeId)
  const documents = useMatterDocuments(matterId).data ?? []
  const target = documents.find((item) => item.id === targetTab?.target)
  const verify = useCreateVerificationRun(target?.id ?? '')
  const redact = useCreateMatterRedactionRun()

  async function uploadFiles(files: File[]) {
    const [first] = files
    for (const file of files) {
      try {
        const result = await upload.mutateAsync(file)
        const tab = documentTab(result.document.id, result.version.filename)
        openPermanent(tab)
        if (file === first) goToTab(tab)
      } catch (error) {
        toast({
          title: 'Upload failed',
          description: `${file.name}: ${error instanceof Error ? error.message : 'Please try again.'}`,
          tone: 'danger',
        })
      }
    }
  }

  function createBlankDocument() {
    void blankDocumentFile()
      .then((file) => uploadFiles([file]))
      .catch((error: unknown) => {
        toast({
          title: 'Could not create the document',
          description:
            error instanceof Error ? error.message : 'Please try again.',
          tone: 'danger',
        })
      })
  }

  function startVerify() {
    const versionId = target?.currentVersionId
    if (!target || !versionId) return
    verify.mutate(versionId, {
      onSuccess: () => {
        const tab = verifyTab()
        openPermanent(tab)
        goToTab(tab)
      },
      onError: (error) =>
        toast({
          title: 'Verify did not start',
          description:
            error instanceof Error ? error.message : 'Please try again.',
          tone: 'danger',
        }),
    })
  }

  function startRedact() {
    if (!target) return
    void redact
      .mutateAsync(target.id)
      .then((result) => {
        const tab = redactTab(
          result.run.id,
          target.currentVersion?.filename ?? target.logicalKey,
        )
        openPermanent(tab)
        goToTab(tab)
      })
      .catch((error: unknown) => {
        toast({
          title: 'Redact did not start',
          description:
            error instanceof Error ? error.message : 'Please try again.',
          tone: 'danger',
        })
      })
  }

  const actions = {
    n: createBlankDocument,
    u: () => inputRef.current?.click(),
    v: startVerify,
    d: startRedact,
  }

  function runAccelerator(event: KeyboardEvent<HTMLDivElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key !== 'n' && key !== 'u' && key !== 'v' && key !== 'd') return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    actions[key]()
  }

  function runItem(action: () => void) {
    setOpen(false)
    action()
  }

  const runTarget = target?.currentVersion?.filename ?? target?.logicalKey

  return (
    <>
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          render={
            <button
              type="button"
              aria-label="New in this matter"
              className="flex h-7 shrink-0 self-center items-center gap-0.5 rounded-md px-1.5 text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus size={15} aria-hidden />
              <CaretDown size={10} aria-hidden />
            </button>
          }
        />
        <MenuContent
          aria-label="New in this matter"
          onKeyDownCapture={runAccelerator}
        >
          <MenuItem onClick={() => runItem(createBlankDocument)}>
            <FileText size={15} aria-hidden className="text-subtle" />
            <span className="flex-1">Blank document</span>
            <KeyboardHint>N</KeyboardHint>
          </MenuItem>
          <MenuItem onClick={() => runItem(actions.u)}>
            <Upload size={15} aria-hidden className="text-subtle" />
            <span className="flex-1">Upload documents</span>
            <KeyboardHint>U</KeyboardHint>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            disabled={!target || verify.isPending}
            onClick={() => runItem(startVerify)}
          >
            <ShieldCheck size={15} aria-hidden className="text-subtle" />
            <span className="min-w-0 flex-1 truncate">
              {runTarget ? `Verify ${runTarget}` : 'Verify a document'}
            </span>
            <KeyboardHint>V</KeyboardHint>
          </MenuItem>
          <MenuItem
            disabled={!target || redact.isPending}
            onClick={() => runItem(startRedact)}
          >
            <PencilSimple size={15} aria-hidden className="text-subtle" />
            <span className="min-w-0 flex-1 truncate">
              {runTarget ? `Redact ${runTarget}` : 'Redact a document'}
            </span>
            <KeyboardHint>D</KeyboardHint>
          </MenuItem>
        </MenuContent>
      </Menu>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label="Upload documents"
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) void uploadFiles(files)
        }}
      />
    </>
  )
}

function activeDocumentTab(
  tabs: MatterTab[],
  activeId: string | null,
): MatterTab | null {
  const active = tabs.find((tab) => tab.id === activeId)
  if (active?.kind === 'document') return active
  return [...tabs].reverse().find((tab) => tab.kind === 'document') ?? null
}
