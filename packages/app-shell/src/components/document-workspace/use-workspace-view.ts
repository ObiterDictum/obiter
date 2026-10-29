import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { DocumentModelWire } from '@obiter/contracts'

import type { DocumentPrintOutcome } from '../../document-print'

import type { FormatTarget } from '../../document-format-edits'
import { documentFormatToolbar } from '../../document-format-edits'
import { documentOutline } from '../../document-outline'
import type { DocumentLayoutFlow } from '../../document-page-engine'
import { rulerContextFor } from '../../document-ruler'
import type { LaidOutPage } from '../../document-page-engine'
import type { WorkspaceDrafts } from './use-workspace-drafts'
import { useElementWidth } from './use-element-width'

export type WorkspaceView = 'print' | 'web'

export function pageZoomFor(
  zoom: number,
  columnWidth: number | null,
  pageWidth: number,
) {
  if (pageWidth <= 0) return zoom
  const available = (columnWidth ?? pageWidth + 16) - 16
  const fit = Math.min(100, Math.floor((available / pageWidth) * 100))
  return Math.max(50, Math.round((zoom * fit) / 100))
}

export function useWorkspaceView(modelLoaded = true) {
  const [view, setView] = useState<WorkspaceView>('print')
  const [compareOpen, setCompareOpen] = useState(false)
  const [requests, setRequests] = useState({
    find: 0,
    palette: 0,
    formatting: 0,
  })
  const request = (surface: keyof typeof requests) =>
    setRequests((current) => ({
      ...current,
      [surface]: current[surface] + 1,
    }))
  const [rulerOn, setRulerOn] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [spelling, setSpelling] = useState(false)
  const columnRef = useRef<HTMLDivElement>(null)
  const columnWidth = useElementWidth(columnRef, modelLoaded)
  const webWidthPx = Math.max(320, (columnWidth ?? 720) - 16)
  const flow = useMemo<DocumentLayoutFlow | undefined>(
    () => (view === 'web' ? { kind: 'web', widthPx: webWidthPx } : undefined),
    [view, webWidthPx],
  )
  const viewRef = useRef(view)
  const printSwitch = useMemo(() => {
    let switched = false
    return {
      before() {
        if (switched || viewRef.current !== 'web') return
        switched = true
        flushSync(() => setView('print'))
      },
      after() {
        if (!switched) return
        switched = false
        setView('web')
      },
    }
  }, [])
  useEffect(() => {
    viewRef.current = view
  }, [view])
  useEffect(() => {
    window.addEventListener('beforeprint', printSwitch.before)
    window.addEventListener('afterprint', printSwitch.after)
    return () => {
      window.removeEventListener('beforeprint', printSwitch.before)
      window.removeEventListener('afterprint', printSwitch.after)
    }
  }, [printSwitch])
  const forPrint = useCallback(
    (run: () => DocumentPrintOutcome) => {
      printSwitch.before()
      const outcome = run()
      if (outcome.status !== 'printed') printSwitch.after()
      return outcome
    },
    [printSwitch],
  )
  return {
    view,
    setView,
    columnWidth,
    compareOpen,
    setCompareOpen,
    requests,
    request,
    forPrint,
    rulerOn,
    toggleRuler: () => setRulerOn((value) => !value),
    navOpen,
    toggleNavPane: () => setNavOpen((value) => !value),
    spelling,
    columnRef,
    flow,
    toggleSpelling: (onNotice: (notice: string) => void) => {
      onNotice(
        spelling
          ? 'Spell-check is off.'
          : 'Spell-check is on: the browser underlines words its local dictionary flags, on this device only. It is not a legal correctness check.',
      )
      setSpelling((value) => !value)
    },
  }
}

export function useWorkspaceSurface(input: {
  painted: DocumentModelWire | undefined
  pages: readonly LaidOutPage[]
  drafts: WorkspaceDrafts
  formatTarget: FormatTarget
  selectedParagraphId: string | null
  trackChanges: boolean
  editingKind: string
  selectParagraph: (paragraphId: string, offset?: number) => void
  closeEditingStory: () => void
  setView: (view: WorkspaceView) => void
  revealParagraph: (paragraphId: string) => void
}) {
  const {
    painted,
    pages,
    drafts,
    formatTarget,
    selectedParagraphId,
    trackChanges,
    editingKind,
    selectParagraph,
    closeEditingStory,
    setView,
    revealParagraph,
  } = input
  const format = painted
    ? documentFormatToolbar(
        painted,
        drafts.format,
        selectedParagraphId,
        drafts.setFormat,
        formatTarget,
        trackChanges,
        drafts.drafts,
        drafts.extraRuns,
      )
    : undefined
  const outline = useMemo(
    () =>
      painted
        ? documentOutline(
            painted,
            drafts.drafts,
            drafts.extraRuns,
            drafts.format.paragraphStyles,
          )
        : [],
    [painted, drafts.drafts, drafts.extraRuns, drafts.format.paragraphStyles],
  )
  const ruler = useMemo(
    () => rulerContextFor({ pages, painted, paragraphId: selectedParagraphId }),
    [pages, selectedParagraphId, painted],
  )
  return {
    format,
    outline,
    ruler,
    onView: (next: WorkspaceView) => {
      if (next === 'web' && editingKind !== 'document') closeEditingStory()
      setView(next)
    },
    onSelectOutline: (paragraphId: string) => {
      if (editingKind !== 'document') closeEditingStory()
      selectParagraph(paragraphId, 0)
      revealParagraph(paragraphId)
    },
  }
}
