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

/**
 * The View ribbon's surface state: layout view, ruler, navigation pane and
 * browser spell-checking. All are per-document UI choices — they reset on
 * remount like the panel opens and are never persisted into a draft.
 */
export function useWorkspaceView() {
  const [view, setView] = useState<WorkspaceView>('print')
  const [rulerOn, setRulerOn] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [spelling, setSpelling] = useState(false)
  // The web flow wraps to the column the desk gives it; the observer measures
  // that column so the page engine lays out at a real width rather than a
  // guessed one.
  const columnRef = useRef<HTMLDivElement>(null)
  const columnWidth = useElementWidth(columnRef)
  const webWidthPx = Math.max(320, (columnWidth ?? 720) - 16)
  const flow = useMemo<DocumentLayoutFlow | undefined>(
    () => (view === 'web' ? { kind: 'web', widthPx: webWidthPx } : undefined),
    [view, webWidthPx],
  )
  // Paper output is always the paginated print flow: a web sheet is one
  // continuous element measured against an unbounded internal frame, so
  // printing it directly produces a clipped, mile-long page. Before any print
  // — the ribbon control, Ctrl+P or the browser menu — the view switches to
  // print layout synchronously, and `afterprint` restores it. A platform that
  // never fires `afterprint` simply leaves the workspace in print layout.
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
  // Runs a print request against a repaginated print view and undoes the
  // switch when the platform reports no dialog ever opened — no `afterprint`
  // will arrive to restore it in that case.
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
    forPrint,
    rulerOn,
    toggleRuler: () => setRulerOn((value) => !value),
    navOpen,
    toggleNavPane: () => setNavOpen((value) => !value),
    spelling,
    columnRef,
    flow,
    /** The toggle announces what it switches: the browser's own dictionary,
     * on this device only — never a legal correctness claim. */
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

/**
 * The surface derivations the desk paints and the view controls drive: the
 * heading outline, the ruler's page geometry, the format toolbar's state and
 * the handlers that move the caret between them.
 */
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
  // The navigation pane's headings — the TOC outline rule over the painted
  // model, so a pending heading style or an edited heading text already lists.
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
  // The ruler measures the page holding the caret — its own section box,
  // frame and column — with the caret paragraph's resolved indents as the
  // markers; a caret outside the body falls back to the first page's frame.
  const ruler = useMemo(
    () => rulerContextFor({ pages, painted, paragraphId: selectedParagraphId }),
    [pages, selectedParagraphId, painted],
  )
  return {
    format,
    outline,
    ruler,
    // Web layout has no margin bands, so an open header, footer or footnotes
    // story closes first — its caret would otherwise sit in paint it cannot
    // edit. Drafts and history are untouched by the view switch.
    onView: (next: WorkspaceView) => {
      if (next === 'web' && editingKind !== 'document') closeEditingStory()
      setView(next)
    },
    // An outline selection is the same caret placement a body click makes:
    // any open margin story closes first, the caret lands at the heading's
    // start, and the desk scrolls the paragraph into view.
    onSelectOutline: (paragraphId: string) => {
      if (editingKind !== 'document') closeEditingStory()
      selectParagraph(paragraphId, 0)
      revealParagraph(paragraphId)
    },
  }
}
