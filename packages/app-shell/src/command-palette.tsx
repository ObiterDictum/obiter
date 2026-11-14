import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@obiter/ui'
import {
  Suspense,
  createContext,
  lazy,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  documentsKeys,
  uploadMatterDocumentRequest,
  type DocumentUploadResponse,
} from './documents'
import { currentUserQueryOptions } from './current-user'
import { useMattersList } from './matters'
import { matterIdFromPath } from './navigation'
import { useShellShortcuts } from './shell-shortcuts'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings-sections'
import { setShellLayout } from './shell-layout'
import { setAppTheme, useAppTheme } from './use-app-theme'
import type {
  PaletteActionId,
  PaletteCreateId,
  PaletteRow,
} from './command-palette-rows'

const CommandPaletteDialogLazy = lazy(() =>
  import('./command-palette-dialog').then((module) => ({
    default: module.CommandPaletteDialog,
  })),
)

const CreateMatterDialogLazy = lazy(() =>
  import('./views/create-matter-dialog').then((module) => ({
    default: module.CreateMatterDialog,
  })),
)

interface CommandPaletteState {
  feedback: () => void
  open: (trigger?: HTMLElement | null) => void
}

const CommandPaletteContext = createContext<CommandPaletteState | null>(null)

export function useFeedback() {
  const context = useContext(CommandPaletteContext)
  if (!context) throw new Error('Feedback needs the shell')
  return context.feedback
}

const FeedbackDialogLazy = lazy(() =>
  import('./feedback-dialog').then((module) => ({
    default: module.FeedbackDialog,
  })),
)

export function useCommandPalette(): (trigger?: HTMLElement | null) => void {
  const context = useContext(CommandPaletteContext)
  if (!context) {
    throw new Error('useCommandPalette must be used inside the app shell frame')
  }
  return context.open
}

export function CommandPaletteProvider({
  onToggleNav,
  onToggleRightSlot,
  onToggleFocusMode,
  children,
}: {
  onToggleNav: () => void
  onToggleRightSlot: () => void
  onToggleFocusMode: () => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const theme = useAppTheme()
  const { data: me } = useQuery(currentUserQueryOptions())
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const matters = useMattersList().data ?? []
  const currentMatterId = matterIdFromPath(pathname)
  const currentMatterName =
    matters.find((matter) => matter.id === currentMatterId)?.name ?? null
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [createMatterOpen, setCreateMatterOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadTargetRef = useRef<string | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const openRef = useRef(false)
  const upload = useMutation<
    DocumentUploadResponse,
    Error,
    { matterId: string; file: File }
  >({
    mutationFn: ({ matterId, file }) =>
      uploadMatterDocumentRequest(matterId, file),
    onSuccess: (_result, { matterId }) =>
      queryClient.invalidateQueries({
        queryKey: documentsKeys.byMatter(matterId),
      }),
  })

  function openPalette(trigger?: HTMLElement | null) {
    openRef.current = true
    returnFocusRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null)
    setOpen(true)
  }

  function closePalette() {
    openRef.current = false
    setOpen(false)
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (!target) return
    window.setTimeout(() => {
      if (!openRef.current) target.focus()
    }, 0)
  }

  useShellShortcuts({ 'open-palette': openPalette })

  function settingRow(id: SettingsSectionId, label: string): PaletteRow {
    const targets = {
      account: 'settings-account',
      security: 'settings-security',
      organisation: 'settings-organisation',
      preferences: 'settings-preferences',
      members: 'settings-members',
      agent: 'settings-agent',
    } satisfies Record<SettingsSectionId, PaletteActionId>
    return {
      id: `action-settings-${id}`,
      label: `Open ${label.toLowerCase()} settings`,
      hint: 'Settings',
      target: { kind: 'action', id: targets[id] },
    }
  }

  function openSettings(section: SettingsSectionId) {
    void navigate({ to: '/settings', search: { section } })
  }

  const actionRows: PaletteRow[] = [
    {
      id: 'send-feedback',
      label: 'Send feedback',
      target: { kind: 'action', id: 'send-feedback' },
    },
    {
      id: 'action-toggle-nav',
      label: 'Toggle sidebar',
      hint: 'Show or hide the navigation',
      shortcut: 'toggle-nav',
      target: { kind: 'action', id: 'toggle-nav' },
    },
    {
      id: 'action-toggle-right-slot',
      label: 'Toggle agent panel',
      hint: 'Open the right-hand panel',
      shortcut: 'toggle-right-slot',
      target: { kind: 'action', id: 'toggle-right-slot' },
    },
    {
      id: 'action-focus-mode',
      label: 'Focus mode',
      hint: 'Hide the sidebar, contents and panel',
      shortcut: 'focus-mode',
      target: { kind: 'action', id: 'focus-mode' },
    },
    {
      id: 'action-toggle-theme',
      label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
      hint: 'Change how Obiter looks',
      target: { kind: 'action', id: 'toggle-theme' },
    },
    {
      id: 'action-layout-sidebar',
      label: 'Switch to sidebar layout',
      hint: 'Navigation beside the page',
      target: { kind: 'action', id: 'layout-sidebar' },
    },
    {
      id: 'action-layout-tabs',
      label: 'Switch to tabs layout',
      hint: 'Modules in the title bar',
      target: { kind: 'action', id: 'layout-tabs' },
    },
    {
      id: 'action-layout-clean',
      label: 'Switch to clean layout',
      hint: 'Navigation behind the Obiter mark',
      target: { kind: 'action', id: 'layout-clean' },
    },
    ...SETTINGS_SECTIONS.filter((section) => !me || section.available(me)).map(
      (section) => settingRow(section.id, section.label),
    ),
  ]

  function runAction(id: PaletteActionId) {
    switch (id) {
      case 'send-feedback':
        setFeedbackOpen(true)
        return
      case 'toggle-nav':
        onToggleNav()
        return
      case 'toggle-right-slot':
        onToggleRightSlot()
        return
      case 'focus-mode':
        onToggleFocusMode()
        return
      case 'toggle-theme':
        setAppTheme(theme === 'dark' ? 'light' : 'dark')
        return
      case 'settings-account':
        openSettings('account')
        return
      case 'settings-security':
        openSettings('security')
        return
      case 'settings-organisation':
        openSettings('organisation')
        return
      case 'settings-preferences':
        openSettings('preferences')
        return
      case 'settings-members':
        openSettings('members')
        return
      case 'settings-agent':
        openSettings('agent')
        return
      case 'layout-sidebar':
        setShellLayout('sidebar')
        return
      case 'layout-tabs':
        setShellLayout('tabs')
        return
      case 'layout-clean':
        setShellLayout('clean')
        return
      default: {
        const unhandled: never = id
        throw new Error(`Unknown palette action: ${String(unhandled)}`)
      }
    }
  }

  function finishUpload(result: DocumentUploadResponse) {
    toast({
      title: 'Document uploaded',
      description:
        result.document.currentVersion?.filename ??
        result.version.filename ??
        result.document.logicalKey,
    })
  }

  async function startBlankDocument(matterId: string) {
    try {
      const { blankDocumentFile } = await import('./document-blank')
      const file = await blankDocumentFile()
      const result = await upload.mutateAsync({ matterId, file })
      toast({
        title: 'Document created',
        description: result.version.filename || result.document.logicalKey,
      })
      void navigate({
        to: '/matters/$matterId/documents/$documentId',
        params: { matterId, documentId: result.document.id },
      })
    } catch {
      toast({
        title: 'Could not create the document',
        description: 'The blank document could not be prepared.',
        tone: 'danger',
      })
    }
  }

  function runCreate(id: PaletteCreateId, matterId?: string) {
    if (id === 'new-matter') {
      setCreateMatterOpen(true)
      return
    }
    if (id === 'start-redaction') {
      void navigate({ to: '/redact' })
      return
    }
    if (!matterId) return
    if (id === 'blank-document') {
      void startBlankDocument(matterId)
      return
    }
    uploadTargetRef.current = matterId
    fileInputRef.current?.click()
  }

  return (
    <CommandPaletteContext.Provider
      value={{ open: openPalette, feedback: () => setFeedbackOpen(true) }}
    >
      {children}
      {feedbackOpen ? (
        <Suspense fallback={null}>
          <FeedbackDialogLazy onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      ) : null}
      {open ? (
        <Suspense fallback={null}>
          <CommandPaletteDialogLazy
            currentMatterId={currentMatterId}
            currentMatterName={currentMatterName}
            actions={actionRows}
            onClose={closePalette}
            onAction={runAction}
            onCreate={runCreate}
          />
        </Suspense>
      ) : null}
      {createMatterOpen ? (
        <Suspense fallback={null}>
          <CreateMatterDialogLazy
            trigger={null}
            open
            onOpenChange={setCreateMatterOpen}
          />
        </Suspense>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Upload document"
        tabIndex={-1}
        className="sr-only"
        accept=".docx,.pdf,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => {
          const file = event.target.files?.[0]
          const matterId = uploadTargetRef.current
          uploadTargetRef.current = null
          event.target.value = ''
          if (!file || !matterId) return
          void upload.mutateAsync({ matterId, file }).then(finishUpload, () =>
            toast({
              title: 'Upload failed',
              description: `${file.name} could not be uploaded. Please try again.`,
              tone: 'danger',
            }),
          )
        }}
      />
    </CommandPaletteContext.Provider>
  )
}
