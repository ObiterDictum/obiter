import { useEffect, useRef, useState } from 'react'
import { Check, Minus, Question, Warning } from '@phosphor-icons/react'
import type {
  DocumentModelWire,
  VerificationFindingView,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import { useVerificationWorkspace } from './verification-context'
import { rectsOfRange, renderedRangeFor } from './verification-anchor'
import type { FindingTarget, UnmappedReason } from './verification-mapping'
import {
  verificationStateLabel,
  verificationTypeLabel,
} from '../../verification-copy'

type Box = { left: number; top: number; width: number; height: number }

type PlacedFinding = {
  findings: VerificationFindingView[]
  finding: VerificationFindingView
  target: Extract<FindingTarget, { kind: 'mapped' }>
  boxes: Box[]
  marker: { left: number; top: number }
}

type FindingStateRank = { [K in VerificationFindingView['state']]: number }

const stateRank: FindingStateRank = {
  flagged: 0,
  review_required: 1,
  not_checked: 2,
  clear: 3,
}

function worstOf(findings: VerificationFindingView[]) {
  return findings.reduce((worst, finding) =>
    stateRank[finding.state] < stateRank[worst.state] ? finding : worst,
  )
}

function OutcomeGlyph({ state }: { state: VerificationFindingView['state'] }) {
  switch (state) {
    case 'clear':
      return <Check size={11} weight="bold" aria-hidden />
    case 'flagged':
      return <Warning size={11} weight="fill" aria-hidden />
    case 'review_required':
      return <Question size={11} weight="bold" aria-hidden />
    case 'not_checked':
      return <Minus size={11} weight="bold" aria-hidden />
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

function markerTone(state: VerificationFindingView['state']) {
  switch (state) {
    case 'clear':
      return 'border-line-strong bg-raised text-muted hover:border-success hover:text-success'
    case 'flagged':
      return 'border-danger bg-danger text-white hover:bg-danger'
    case 'review_required':
      return 'border-warning bg-warning/20 text-warning hover:bg-warning/30'
    case 'not_checked':
      return 'border-line-strong bg-surface text-subtle hover:text-ink'
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

function boxTone(state: VerificationFindingView['state']) {
  switch (state) {
    case 'clear':
      return 'bg-success/15'
    case 'flagged':
      return 'bg-danger/20'
    case 'review_required':
      return 'bg-warning/20'
    case 'not_checked':
      return 'bg-line/40'
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

function placementSignature(placed: PlacedFinding[]) {
  return placed
    .map(
      (item) =>
        `${item.findings.map((finding) => finding.id).join('+')}@${item.finding.state}:${item.target.paragraphId}:${item.marker.left},${item.marker.top}` +
        `/${item.boxes.map((box) => `${box.left},${box.top},${box.width},${box.height}`).join(';')}`,
    )
    .join('|')
}

function renderedSignature(
  visible: ReadonlySet<string>,
  reasons: ReadonlyMap<string, UnmappedReason>,
) {
  const visiblePart = [...visible].sort().join(',')
  const reasonPart = [...reasons.entries()]
    .map(([id, reason]) => `${id}:${reason}`)
    .sort()
    .join(',')
  return `${visiblePart}|${reasonPart}`
}

export function VerificationMarkerLayer({
  model,
}: {
  model: DocumentModelWire
}) {
  const verification = useVerificationWorkspace()
  const layer = useRef<HTMLDivElement>(null)
  const [revision, setRevision] = useState(0)
  const [placed, setPlaced] = useState<PlacedFinding[]>([])
  const lastSignature = useRef('')
  const lastRenderedSignature = useRef('')
  const findings = verification?.findings
  const targets = verification?.targets
  const setRendered = verification?.setRendered

  useEffect(() => {
    const desk = layer.current?.closest('[data-document-desk]')
    const content = desk?.firstElementChild
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setRevision((value) => value + 1))
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const desk = layer.current?.closest('[data-document-desk]')
    if (!desk || !targets || !findings) return
    const deskRect = desk.getBoundingClientRect()
    const originLeft = deskRect.left - desk.scrollLeft
    const originTop = deskRect.top - desk.scrollTop
    const groups = new Map<string, VerificationFindingView[]>()
    for (const finding of findings) {
      const target = targets.get(finding.id)
      if (!target || target.kind !== 'mapped') continue
      const key = `${target.paragraphId}\u001f${target.start}\u001f${target.end}`
      const group = groups.get(key)
      if (group) group.push(finding)
      else groups.set(key, [finding])
    }
    const next: PlacedFinding[] = []
    const reasons = new Map<string, UnmappedReason>()
    for (const group of groups.values()) {
      const target = targets.get(group[0]!.id)
      if (!target || target.kind !== 'mapped') continue
      const decisions = group.map((finding) => ({
        finding,
        result: renderedRangeFor(desk, target, finding.excerpt),
      }))
      const attached = decisions.find(
        (
          item,
        ): item is {
          finding: VerificationFindingView
          result: { kind: 'attached'; range: Range; spansFragments: boolean }
        } => item.result.kind === 'attached',
      )
      for (const item of decisions) {
        if (item.result.kind === 'unavailable')
          reasons.set(item.finding.id, item.result.reason)
      }
      if (!attached) continue
      const matching = decisions
        .filter(
          (
            item,
          ): item is {
            finding: VerificationFindingView
            result: { kind: 'attached'; range: Range; spansFragments: boolean }
          } => item.result.kind === 'attached',
        )
        .map((item) => item.finding)
      const rects = rectsOfRange(attached.result.range)
      const last = rects[rects.length - 1]!
      next.push({
        findings: matching,
        finding: worstOf(matching),
        target,
        boxes: rects.map((rect) => ({
          left: rect.left - originLeft,
          top: rect.top - originTop,
          width: rect.width,
          height: rect.height,
        })),
        marker: {
          left: last.right - originLeft + 1,
          top: last.top - originTop - 7,
        },
      })
    }
    const signature = placementSignature(next)
    if (signature !== lastSignature.current) {
      lastSignature.current = signature
      setPlaced(next)
    }
    const visible = new Set(
      next.flatMap((item) => item.findings.map((finding) => finding.id)),
    )
    const nextRenderedSignature = renderedSignature(visible, reasons)
    if (nextRenderedSignature !== lastRenderedSignature.current) {
      lastRenderedSignature.current = nextRenderedSignature
      setRendered?.({ visibleIds: visible, reasons })
    }
  }, [targets, findings, revision, model, setRendered])

  const activeId = verification?.activeId
  const activeMarker = activeId ? verification?.markerFor(activeId) : null
  useEffect(() => {
    if (typeof activeMarker?.scrollIntoView !== 'function') return
    activeMarker.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeMarker])

  if (!verification || !verification.mappable) return null

  return (
    <div
      ref={layer}
      data-verification-layer
      className="pointer-events-none absolute top-0 left-0 h-0 w-0"
    >
      {placed.flatMap((item) => {
        const active = item.findings.some(
          (finding) => finding.id === verification.activeId,
        )
        const label =
          item.findings.length > 1
            ? `${verificationTypeLabel(item.finding.type)}, ${verificationStateLabel(item.finding)}: ${item.finding.authorityLabel} (${item.findings.length} findings here)`
            : `${verificationTypeLabel(item.finding.type)}, ${verificationStateLabel(item.finding)}: ${item.finding.authorityLabel}`
        return [
          ...item.boxes.map((box, index) => (
            <span
              key={`box-${item.findings[0]!.id}-${index}`}
              aria-hidden="true"
              data-verification-highlight={item.findings[0]!.id}
              data-verification-paragraph-id={item.target.paragraphId}
              data-verification-active={active ? 'true' : undefined}
              className={cn(
                'absolute rounded-[2px]',
                boxTone(item.finding.state),
                active && 'ring-1 ring-ink/40',
              )}
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              }}
            />
          )),
          <button
            key={`marker-${item.findings[0]!.id}`}
            type="button"
            ref={(element) =>
              item.findings.forEach((finding) =>
                verification.registerMarker(finding.id, element),
              )
            }
            data-verification-marker={item.finding.id}
            data-verification-paragraph-id={item.target.paragraphId}
            data-verification-active={active ? 'true' : undefined}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={active && verification.panelOpen}
            title={`${verificationTypeLabel(item.finding.type)}: ${verificationStateLabel(item.finding)}`}
            onClick={() => verification.openFinding(item.finding.id)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !active) return
              event.stopPropagation()
              verification.closePanel()
            }}
            className={cn(
              'pointer-events-auto absolute flex h-4 w-4 items-center justify-center',
              'rounded-[4px] border transition-colors duration-150 motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
              markerTone(item.finding.state),
            )}
            style={{ left: item.marker.left, top: item.marker.top }}
          >
            <OutcomeGlyph state={item.finding.state} />
          </button>,
        ]
      })}
    </div>
  )
}
