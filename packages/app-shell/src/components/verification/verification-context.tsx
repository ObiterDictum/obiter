import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { VerificationFindingView } from '@obiter/contracts'
import { useDocument } from '../../documents'
import { useDocumentModel } from '../../document-workspace-api'
import {
  latestVerificationRun,
  useCreateVerificationRun,
  useDocumentVerificationRuns,
  useVerificationFindings,
} from '../../verification-runs'
import { useDocumentDraftStatus } from '../document-workspace/document-draft-status'
import { VerificationEvidencePanel } from './verification-evidence-panel'
import { panelPlacement } from './verification-anchor'
import {
  resolveFindingTarget,
  type FindingTarget,
  type UnmappedReason,
} from './verification-mapping'

/**
 * What the document layer actually drew for the current document. `null` means
 * the layer has not measured yet or this document has no mapped layer. The
 * visible ids and the per-finding reasons are one value so a render can never
 * read half of one document's measurement with half of another's.
 */
export type RenderedFindings = {
  visibleIds: ReadonlySet<string>
  reasons: ReadonlyMap<string, UnmappedReason>
}

/**
 * One owner for the contextual verification interaction: which run and findings
 * are current, which finding is selected, where it maps in the open document,
 * and whether the editor holds unsaved work. The panel, the marker layer, the
 * document-level control and the findings index all read this, so they cannot
 * disagree about what was checked.
 *
 * The verification engine, run model and findings persistence are untouched:
 * this is the presentation boundary over the V5 API.
 */
export type VerificationWorkspaceValue = {
  documentId: string
  mappable: boolean
  run: ReturnType<typeof latestVerificationRun>
  runsPending: boolean
  runsError: Error | null
  documentLost: boolean
  findings: VerificationFindingView[]
  findingsPending: boolean
  findingsError: Error | null
  hasNextPage: boolean
  loadingMore: boolean
  loadMore: () => void
  targets: Map<string, FindingTarget>
  activeId: string | null
  activeIndex: number
  panelOpen: boolean
  openFinding: (findingId: string) => void
  closePanel: () => void
  step: (delta: 1 | -1) => void
  dirty: boolean
  ready: boolean
  checkedVersionId: string | null
  /** The checked version is no longer the stored one: either the API says so or
   * the open document has moved on since the run. */
  stale: boolean
  startRun: () => void
  startPending: boolean
  startError: Error | null
  registerMarker: (findingId: string, element: HTMLElement | null) => void
  markerFor: (findingId: string) => HTMLElement | null
  dockAnchor: HTMLElement | null
  setDockAnchor: (element: HTMLElement | null) => void
  /** What the document layer drew, once it has measured. */
  rendered: RenderedFindings | null
  setRendered: (value: RenderedFindings | null) => void
  /** The server's total for the selected run, not the loaded page count. */
  totalFindings: number
  /** The findings index is a modal list; while it is open the panel's own
   * outside-dismissal rule is suspended so the dialog is not "outside". */
  indexOpen: boolean
  openIndex: () => void
  closeIndex: () => void
  placement: 'floating' | 'drawer'
}

const VerificationWorkspaceContext =
  createContext<VerificationWorkspaceValue | null>(null)

/** The contextual verification context, or null outside a document workspace. */
export function useVerificationWorkspace() {
  return useContext(VerificationWorkspaceContext)
}

/** Read the viewport width for the one responsive placement rule. */
function useViewportWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  )
  // A resize listener is a genuine browser boundary: the placement rule cannot
  // be derived from React state, and Base UI's own media handling targets the
  // popup, not the choice between a floating panel and a drawer.
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

export function VerificationWorkspaceProvider({
  documentId,
  mappable,
  children,
}: {
  documentId: string
  mappable: boolean
  children: ReactNode
}) {
  const document = useDocument(documentId)
  const runs = useDocumentVerificationRuns(documentId)
  const create = useCreateVerificationRun(documentId)
  const draftStatus = useDocumentDraftStatus()
  const dirty = draftStatus?.dirty ?? false
  const model = useDocumentModel(documentId, { enabled: mappable })
  const latest = latestVerificationRun(runs.data?.runs ?? [])
  const findingsQuery = useVerificationFindings(
    latest && latest.status === 'completed' ? latest.id : null,
  )
  const findings = findingsQuery.findings
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [indexOpen, setIndexOpen] = useState(false)
  const [dockAnchor, setDockAnchor] = useState<HTMLElement | null>(null)
  const [rendered, setRendered] = useState<RenderedFindings | null>(null)
  const markers = useRef(new Map<string, HTMLElement>())
  const pendingStep = useRef<number | null>(null)
  const placement = panelPlacement(useViewportWidth())

  // Mapping, navigation and marker coverage must span the whole finding set,
  // not only the pages fetched so far. The endpoint is keyset-paginated, so the
  // provider walks the remaining pages once a completed run is selected; each
  // completed page re-runs this effect and starts the next. It is a real
  // network boundary, so the guard and the cleanup are deliberate.
  const hasNextPage = findingsQuery.hasNextPage
  const fetchingNextPage = findingsQuery.isFetchingNextPage
  const findingsFailed = findingsQuery.isError
  const fetchNextPage = findingsQuery.fetchNextPage
  useEffect(() => {
    // A failed page stops the walk and surfaces through findingsError instead of
    // retrying on every render.
    if (!hasNextPage || fetchingNextPage || findingsFailed) return
    void fetchNextPage()
  }, [hasNextPage, fetchingNextPage, findingsFailed, fetchNextPage])

  const version = document.data?.document.currentVersion
  const ready = version?.documentStatus === 'ready'
  const checkedVersionId = latest?.documentVersionId ?? version?.id ?? null
  // The run row reports staleness against the stored pointer. The open
  // document's own version is the faster and, after a save, the truer signal,
  // so either one marks the evidence as earlier than the document.
  const stale =
    latest != null &&
    (latest.stale ||
      (version != null && latest.documentVersionId !== version.id))

  const targets = useMemo(() => {
    const map = new Map<string, FindingTarget>()
    if (!mappable || !model.data?.model) return map
    for (const finding of findings) {
      map.set(finding.id, resolveFindingTarget(finding, model.data.model))
    }
    return map
  }, [findings, mappable, model.data])

  const activeIndex = findings.findIndex((finding) => finding.id === activeId)
  // The run summary is computed server-side over every finding, so it, not the
  // loaded page, is the truthful total. Fall back to the loaded set only while
  // the run summary is not yet available.
  const totalFindings = latest?.summary.findingCount ?? findings.length

  // A Next/Previous that lands on a page that is not loaded yet is remembered
  // and applied when the page arrives, so navigation is never silently bounded
  // by whichever pages happen to be resident.
  useEffect(() => {
    const pending = pendingStep.current
    if (pending == null) return
    const target = findings[pending]
    if (!target) return
    pendingStep.current = null
    setActiveId(target.id)
    setPanelOpen(true)
  }, [findings])

  const value: VerificationWorkspaceValue = {
    documentId,
    mappable,
    run: latest,
    runsPending: runs.isPending,
    runsError: runs.isError ? (runs.error as Error) : null,
    documentLost: document.isError,
    findings,
    findingsPending: findingsQuery.isPending,
    findingsError: findingsQuery.isError
      ? (findingsQuery.error as Error)
      : null,
    hasNextPage: findingsQuery.hasNextPage,
    loadingMore: findingsQuery.isFetchingNextPage,
    loadMore: () => void findingsQuery.fetchNextPage(),
    targets,
    activeId,
    activeIndex,
    panelOpen: panelOpen && activeIndex >= 0,
    openFinding: (findingId) => {
      setActiveId(findingId)
      setPanelOpen(true)
    },
    closePanel: () => setPanelOpen(false),
    step: (delta) => {
      if (activeIndex < 0) return
      const next = activeIndex + delta
      if (next < 0 || next >= totalFindings) return
      const target = findings[next]
      if (target) {
        setActiveId(target.id)
        setPanelOpen(true)
        return
      }
      // The next finding is on a page that has not arrived yet: request it and
      // let the effect above land on it once it does.
      pendingStep.current = next
      void fetchNextPage()
    },
    dirty,
    ready,
    totalFindings,
    checkedVersionId,
    stale,
    startRun: () => {
      if (!ready || !version || create.isPending || dirty) return
      create.mutate(version.id)
    },
    startPending: create.isPending,
    startError: create.error ? (create.error as Error) : null,
    registerMarker: (findingId, element) => {
      if (element) markers.current.set(findingId, element)
      else markers.current.delete(findingId)
    },
    markerFor: (findingId) => markers.current.get(findingId) ?? null,
    dockAnchor,
    setDockAnchor,
    rendered,
    setRendered,
    indexOpen,
    openIndex: () => setIndexOpen(true),
    closeIndex: () => setIndexOpen(false),
    placement,
  }

  return (
    <VerificationWorkspaceContext.Provider value={value}>
      {children}
      <VerificationEvidencePanel />
    </VerificationWorkspaceContext.Provider>
  )
}
