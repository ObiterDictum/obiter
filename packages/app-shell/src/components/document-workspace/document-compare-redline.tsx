import { useRef, useState } from 'react'
import { Button, Select, cn } from '@obiter/ui'
import { ArrowsLeftRight, X } from '@obiter/ui/icons'
import type {
  DocumentComparisonSegment,
  DocumentCompareResponse,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { paragraphPlainText } from '../../document-model-text'
import {
  useDocumentCompare,
  useDocumentModel,
} from '../../document-workspace-api'
import { formatDate } from '../../format'
import type { DocumentVersionRecord } from '../../documents'
import {
  CompareDifferencesPanel,
  comparisonSegments,
} from './document-compare-differences'
import { TRACKED_DELETE_MARK } from './tracked-marks'
import { DocumentDesk, DocumentPage } from './document-page'
import { useElementWidth } from './use-element-width'
import { A4_WIDTH_PX } from '../../document-page-units'
import { QueryError } from './workspace-chrome'

export function DocumentCompareRedline({
  documentId,
  versions,
  onClose,
}: {
  documentId: string
  versions: DocumentVersionRecord[]
  onClose: () => void
}) {
  const comparable = versions.filter(
    (version) =>
      version.documentStatus === 'ready' && version.fileType === 'docx',
  )
  const [baseId, setBaseId] = useState<string | undefined>()
  const [targetId, setTargetId] = useState<string | undefined>()
  const [pair, setPair] = useState<{
    baseVersionId: string
    targetVersionId: string
  } | null>(null)
  const [active, setActive] = useState(0)
  const resolvedBase = baseId ?? comparable[1]?.id
  const resolvedTarget = targetId ?? comparable[0]?.id
  const options = comparable.map((version) => ({
    value: version.id,
    label: `Version ${String(version.versionNumber)} · ${formatDate(version.createdAt)}`,
  }))
  const base = comparable.find((version) => version.id === resolvedBase)
  const target = comparable.find((version) => version.id === resolvedTarget)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-item text-ink">
            Comparing versions · read only
          </span>
          <span className="text-caption text-muted">
            {base && target
              ? `Changes from version ${String(base.versionNumber)} to version ${String(target.versionNumber)}`
              : 'Choose a base version and a version to compare it with.'}
          </span>
        </div>
        <Select
          ariaLabel="Base"
          size="compact"
          options={options}
          value={resolvedBase}
          onValueChange={(value) => setBaseId(value ?? undefined)}
          className="w-56"
        />
        <span aria-hidden className="text-muted">
          →
        </span>
        <Select
          ariaLabel="Compare to"
          size="compact"
          options={options}
          value={resolvedTarget}
          onValueChange={(value) => setTargetId(value ?? undefined)}
          className="w-56"
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label="Swap base and comparison"
          iconStart={<ArrowsLeftRight size={14} aria-hidden />}
          onClick={() => {
            setBaseId(resolvedTarget)
            setTargetId(resolvedBase)
            setPair(null)
            setActive(0)
          }}
        >
          Swap
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (resolvedBase && resolvedTarget) {
              setActive(0)
              setPair({
                baseVersionId: resolvedBase,
                targetVersionId: resolvedTarget,
              })
            }
          }}
        >
          Compare
        </Button>
        <div className="ms-auto">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close comparison"
            onClick={onClose}
            iconStart={<X size={14} aria-hidden />}
          >
            Close
          </Button>
        </div>
      </div>
      {pair ? (
        <CompareBody
          documentId={documentId}
          baseVersionId={pair.baseVersionId}
          targetVersionId={pair.targetVersionId}
          active={active}
          onActive={setActive}
          onClose={onClose}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-body text-muted">
          Choose two versions and select Compare to see the redline.
        </div>
      )}
    </div>
  )
}

function CompareBody({
  documentId,
  baseVersionId,
  targetVersionId,
  active,
  onActive,
  onClose,
}: {
  documentId: string
  baseVersionId: string
  targetVersionId: string
  active: number
  onActive: (index: number) => void
  onClose: () => void
}) {
  const compare = useDocumentCompare(documentId, baseVersionId, targetVersionId)
  const base = useDocumentModel(documentId, { versionId: baseVersionId })
  const target = useDocumentModel(documentId, { versionId: targetVersionId })
  if (compare.isLoading) {
    return (
      <div className="p-6 text-body text-muted" aria-busy="true">
        Comparing versions…
      </div>
    )
  }
  if (compare.isError) {
    return (
      <div className="p-6">
        <QueryError
          error={compare.error}
          fallback="The versions could not be compared."
        />
      </div>
    )
  }
  if (!compare.data) return null
  if (target.isLoading || base.isLoading) {
    return (
      <div className="p-6 text-body text-muted" aria-busy="true">
        Loading both versions…
      </div>
    )
  }
  if (target.isError || base.isError) {
    return (
      <div className="p-6">
        <QueryError
          error={target.error ?? base.error}
          fallback="The versions could not be loaded for the redline."
        />
      </div>
    )
  }
  if (!target.data || !base.data) return null
  return (
    <DocumentComparisonView
      data={compare.data}
      base={base.data.model}
      target={target.data.model}
      active={active}
      onActive={onActive}
      onClose={onClose}
    />
  )
}

type ComparisonBlock =
  | {
      kind: 'paragraph'
      paragraph: DocumentParagraphWire
      entryIndex?: number
      segments?: readonly DocumentComparisonSegment[]
    }
  | { kind: 'removed'; text: string; entryIndex: number }

export function comparisonBlocks(
  data: DocumentCompareResponse,
  base: DocumentModelWire,
  target: DocumentModelWire,
): ComparisonBlock[] {
  const entryByParagraph = new Map<string, number>()
  data.entries.forEach((entry, index) => {
    if ('paragraphId' in entry) entryByParagraph.set(entry.paragraphId, index)
  })
  const targetParagraphIds = new Set(
    target.stories.flatMap((story) => story.paragraphs.map((item) => item.id)),
  )
  const removalsByAnchor = new Map<string, ComparisonBlock[]>()
  const trailing: ComparisonBlock[] = []
  data.entries.forEach((entry, index) => {
    if (entry.type !== 'removed') return
    const story = base.stories.find((item) =>
      item.paragraphs.some((paragraph) => paragraph.id === entry.paragraphId),
    )
    const at = story?.paragraphs.findIndex(
      (paragraph) => paragraph.id === entry.paragraphId,
    )
    const anchor =
      at === undefined || at < 0
        ? undefined
        : story?.paragraphs
            .slice(at + 1)
            .find((paragraph) => targetParagraphIds.has(paragraph.id))
    const block: ComparisonBlock = {
      kind: 'removed',
      text: entry.text,
      entryIndex: index,
    }
    if (!anchor) {
      trailing.push(block)
      return
    }
    const list = removalsByAnchor.get(anchor.id) ?? []
    list.push(block)
    removalsByAnchor.set(anchor.id, list)
  })
  const blocks: ComparisonBlock[] = []
  for (const story of target.stories) {
    for (const paragraph of story.paragraphs) {
      blocks.push(...(removalsByAnchor.get(paragraph.id) ?? []))
      blocks.push({
        kind: 'paragraph',
        paragraph,
        entryIndex: entryByParagraph.get(paragraph.id),
        segments: segmentsFor(data, entryByParagraph.get(paragraph.id)),
      })
    }
  }
  return [...blocks, ...trailing]
}

function segmentsFor(data: DocumentCompareResponse, index: number | undefined) {
  const entry = index === undefined ? undefined : data.entries[index]
  return entry?.type === 'modified' ? entry.segments : undefined
}

const COMPARE_PAGE_ZOOM = 90
const COMPARE_MIN_ZOOM = 80
const COMPARE_DESK_GUTTER = 64

export function comparisonPageLayout(deskWidth: number | null) {
  const room = deskWidth === null ? null : deskWidth - COMPARE_DESK_GUTTER
  if (room === null || room >= (A4_WIDTH_PX * COMPARE_PAGE_ZOOM) / 100)
    return { zoom: COMPARE_PAGE_ZOOM, width: A4_WIDTH_PX }
  const fit = Math.floor((room / A4_WIDTH_PX) * 100)
  if (fit >= COMPARE_MIN_ZOOM) return { zoom: fit, width: A4_WIDTH_PX }
  return {
    zoom: COMPARE_MIN_ZOOM,
    width: Math.floor((room * 100) / COMPARE_MIN_ZOOM),
  }
}

export function DocumentComparisonView({
  data,
  base,
  target,
  active,
  onActive,
  onClose,
}: {
  data: DocumentCompareResponse
  base: DocumentModelWire
  target: DocumentModelWire
  active: number
  onActive: (index: number) => void
  onClose: () => void
}) {
  const blocks = comparisonBlocks(data, base, target)
  const deskRef = useRef<HTMLDivElement>(null)
  const page = comparisonPageLayout(useElementWidth(deskRef))
  const jumpTo = (index: number) => {
    onActive(index)
    document
      .getElementById(`compare-entry-${String(index)}`)
      ?.scrollIntoView?.({ block: 'center' })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col items-stretch overflow-hidden lg:flex-row">
      <DocumentDesk deskRef={deskRef}>
        <div className="flex w-full min-w-0 flex-col items-center gap-6">
          <DocumentPage zoom={page.zoom} width={page.width}>
            <div className="flex flex-col gap-2 p-14" data-compare-redline>
              <p className="mb-2 text-caption text-paper-muted">
                Changes from version {data.base.versionNumber} to version{' '}
                {data.target.versionNumber}
                {data.identical ? ' · identical' : null}
              </p>
              {data.identical ? (
                <p className="text-body text-ink">
                  These versions are identical.
                </p>
              ) : (
                blocks.map((block, index) => (
                  <ComparisonBlockView
                    key={blockKey(block, index)}
                    block={block}
                    active={active}
                  />
                ))
              )}
            </div>
          </DocumentPage>
        </div>
      </DocumentDesk>
      <CompareDifferencesPanel
        data={data}
        active={active}
        onJump={jumpTo}
        onClose={onClose}
      />
    </div>
  )
}

function blockKey(block: ComparisonBlock, index: number) {
  return block.kind === 'paragraph'
    ? `${block.paragraph.id}-${String(index)}`
    : `${block.kind}-${String(block.entryIndex)}`
}

function ComparisonBlockView({
  block,
  active,
}: {
  block: ComparisonBlock
  active: number
}) {
  const id =
    block.kind !== 'paragraph' || block.entryIndex !== undefined
      ? `compare-entry-${String(block.entryIndex)}`
      : undefined
  const isActive = block.entryIndex === active
  const activeClasses = isActive
    ? 'outline-2 outline-offset-2 outline-ring'
    : ''
  if (block.kind === 'removed') {
    return (
      <p
        id={id}
        className={cn(
          'rounded-sm bg-danger-surface px-1 text-body break-words whitespace-pre-wrap',
          TRACKED_DELETE_MARK,
          activeClasses,
        )}
      >
        {block.text === '' ? '(empty paragraph)' : block.text}
      </p>
    )
  }
  const text = paragraphPlainText(block.paragraph)
  return (
    <p
      id={id}
      className={cn(
        'rounded-sm px-1 text-body break-words whitespace-pre-wrap text-paper-ink',
        block.entryIndex === undefined ? undefined : 'bg-warning-soft',
        activeClasses,
      )}
    >
      {block.segments === undefined
        ? text === ''
          ? '\u00a0'
          : text
        : comparisonSegments(block.segments, 'paper')}
    </p>
  )
}
