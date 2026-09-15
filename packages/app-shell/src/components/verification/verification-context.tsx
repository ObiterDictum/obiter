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
} from './verification-mapping'

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
  startRun: () => void
  startPending: boolean
  startError: Error | null
  registerMarker: (findingId: string, element: HTMLElement | null) => void
  markerFor: (findingId: string) => HTMLElement | null
  dockAnchor: HTMLElement | null
  setDockAnchor: (element: HTMLElement | null) => void
  /** Findings the document layer actually rendered a marker for. `null` means
   * the layer has not measured yet or this document has no mapped layer. */
  visibleIds: ReadonlySet<string> | null
  setVisibleIds: (ids: ReadonlySet<string> | null) => void
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
  const [dockAnchor, setDockAnchor] = useState<HTMLElement | null>(null)
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string> | null>(null)
  const markers = useRef(new Map<string, HTMLElement>())
  const placement = panelPlacement(useViewportWidth())

  const version = document.data?.document.currentVersion
  const ready = version?.documentStatus === 'ready'
  const checkedVersionId = latest?.documentVersionId ?? version?.id ?? null

  const targets = useMemo(() => {
    const map = new Map<string, FindingTarget>()
    if (!mappable || !model.data?.model) return map
    for (const finding of findings) {
      map.set(finding.id, resolveFindingTarget(finding, model.data.model))
    }
    return map
  }, [findings, mappable, model.data])

  const activeIndex = findings.findIndex((finding) => finding.id === activeId)

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
      const next = activeIndex + delta
      if (activeIndex < 0 || next < 0 || next >= findings.length) return
      setActiveId(findings[next]!.id)
      setPanelOpen(true)
    },
    dirty,
    ready,
    checkedVersionId,
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
    visibleIds,
    setVisibleIds,
    placement,
  }

  return (
    <VerificationWorkspaceContext.Provider value={value}>
      {children}
      <VerificationEvidencePanel />
    </VerificationWorkspaceContext.Provider>
  )
}
