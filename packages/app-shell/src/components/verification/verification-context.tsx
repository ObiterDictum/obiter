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

export type RenderedFindings = {
  visibleIds: ReadonlySet<string>
  reasons: ReadonlyMap<string, UnmappedReason>
}

type StartAvailability =
  { available: true } | { available: false; reason: string }

export const verificationDockId = 'document-verification'

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
  retryFindings: () => void
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
  checkedVersionNumber: number | undefined
  currentVersionNumber: number | undefined
  stale: boolean
  startRun: () => void
  startPending: boolean
  startError: Error | null
  startAvailability: StartAvailability
  registerMarker: (findingId: string, element: HTMLElement | null) => void
  markerFor: (findingId: string) => HTMLElement | null
  dockAnchor: HTMLElement | null
  setDockAnchor: (element: HTMLElement | null) => void
  setStartAnchor: (element: HTMLElement | null) => void
  revealStart: () => void
  rendered: RenderedFindings | null
  setRendered: (value: RenderedFindings | null) => void
  totalFindings: number
  indexOpen: boolean
  openIndex: () => void
  closeIndex: () => void
  placement: 'floating' | 'drawer'
}

const VerificationWorkspaceContext =
  createContext<VerificationWorkspaceValue | null>(null)

export function useVerificationWorkspace() {
  return useContext(VerificationWorkspaceContext)
}

function useViewportWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  )
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
  const findingsRunId =
    latest && latest.status === 'completed' ? latest.id : null
  const findingsQuery = useVerificationFindings(findingsRunId)
  const findings = findingsQuery.findings
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [indexOpen, setIndexOpen] = useState(false)
  const [dockAnchor, setDockAnchor] = useState<HTMLElement | null>(null)
  const [startAnchor, setStartAnchor] = useState<HTMLElement | null>(null)
  const [revealPending, setRevealPending] = useState(false)
  const [rendered, setRendered] = useState<RenderedFindings | null>(null)
  const markers = useRef(new Map<string, HTMLElement>())
  const pendingStep = useRef<number | null>(null)
  const placement = panelPlacement(useViewportWidth())

  const hasNextPage = findingsQuery.hasNextPage
  const fetchingNextPage = findingsQuery.isFetchingNextPage
  const findingsFailed = findingsQuery.isError
  const fetchNextPage = findingsQuery.fetchNextPage
  const refetchFindings = findingsQuery.refetch
  useEffect(() => {
    if (!hasNextPage || fetchingNextPage || findingsFailed) return
    void fetchNextPage()
  }, [hasNextPage, fetchingNextPage, findingsFailed, fetchNextPage])

  const retryFindings = () => {
    const attempt =
      findings.length > 0 && hasNextPage ? fetchNextPage() : refetchFindings()
    void attempt.catch(() => undefined)
  }

  const version = document.data?.document.currentVersion
  const ready = version?.documentStatus === 'ready'
  const checkedVersionId = latest?.documentVersionId ?? version?.id ?? null
  const versionNumbers = new Map(
    (document.data?.versions ?? []).map((record) => [
      record.id,
      record.versionNumber,
    ]),
  )
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
  const totalFindings = latest?.summary.findingCount ?? findings.length

  const startAvailability: StartAvailability = document.isPending
    ? { available: false, reason: 'the document is still loading' }
    : document.isError
      ? { available: false, reason: 'this document is unavailable' }
      : runs.isPending
        ? { available: false, reason: 'verification status is still loading' }
        : runs.isError
          ? { available: false, reason: 'verification runs are unavailable' }
          : create.isPending
            ? {
                available: false,
                reason: 'a verification run is already starting',
              }
            : !ready
              ? {
                  available: false,
                  reason: 'the document is not ready to verify',
                }
              : dirty
                ? { available: false, reason: 'save before verification' }
                : { available: true }

  useEffect(() => {
    if (!revealPending || !startAnchor) return
    setRevealPending(false)
    startAnchor.scrollIntoView?.({ block: 'nearest' })
    startAnchor.focus({ preventScroll: true })
  }, [revealPending, startAnchor])

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
    runsError: runs.isError ? runs.error : null,
    documentLost: document.isError,
    findings,
    findingsPending: findingsQuery.isPending,
    findingsError: findingsQuery.isError ? findingsQuery.error : null,
    retryFindings,
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
      pendingStep.current = next
      void fetchNextPage()
    },
    dirty,
    ready,
    totalFindings,
    checkedVersionNumber: checkedVersionId
      ? versionNumbers.get(checkedVersionId)
      : undefined,
    currentVersionNumber: version?.versionNumber,
    stale,
    startRun: () => {
      if (!ready || !version || create.isPending || dirty) return
      create.mutate(version.id)
    },
    startPending: create.isPending,
    startError: create.error ? create.error : null,
    startAvailability,
    registerMarker: (findingId, element) => {
      if (element) markers.current.set(findingId, element)
      else markers.current.delete(findingId)
    },
    markerFor: (findingId) => markers.current.get(findingId) ?? null,
    dockAnchor,
    setDockAnchor,
    setStartAnchor,
    revealStart: () => {
      if (!startAnchor) {
        setRevealPending(true)
        return
      }
      startAnchor.scrollIntoView?.({ block: 'nearest' })
      startAnchor.focus({ preventScroll: true })
    },
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
