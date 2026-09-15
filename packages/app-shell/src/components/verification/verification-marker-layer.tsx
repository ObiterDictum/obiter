import { useEffect, useRef, useState } from 'react'
import { Check, Minus, Question, Warning } from '@phosphor-icons/react'
import type {
  DocumentModelWire,
  VerificationFindingView,
} from '@obiter/contracts'
import { cn } from '@obiter/ui'
import { useVerificationWorkspace } from './verification-context'
import { rangeForTarget, rectsOfRange } from './verification-anchor'
import type { FindingTarget } from './verification-mapping'
import {
  verificationStateLabel,
  verificationTypeLabel,
} from '../../verification-copy'

type Box = { left: number; top: number; width: number; height: number }

type PlacedFinding = {
  /** The findings that share this place in the document, in list order. A
   * citation produces both a resolution check and an existence check, and two
   * markers on one range would hide each other. */
  findings: VerificationFindingView[]
  /** The most serious outcome at this place, which is what the marker shows. */
  finding: VerificationFindingView
  target: Extract<FindingTarget, { kind: 'mapped' }>
  boxes: Box[]
  marker: { left: number; top: number }
}

/** Worst outcome first, so one marker for one place never understates it. */
const stateRank: Record<VerificationFindingView['state'], number> = {
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

/** A shape per outcome, so state never depends on colour alone. */
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

/**
 * A flat signature of what was measured. It exists so a provider re-render that
 * produces the same positions does not write state again: measurement depends
 * on object identities a refetch may replace, and an unguarded write would
 * re-render, re-measure and never settle.
 */
function placementSignature(placed: PlacedFinding[]) {
  return placed
    .map(
      (item) =>
        `${item.findings.map((finding) => finding.id).join('+')}@${item.finding.state}:${item.target.paragraphId}:${item.marker.left},${item.marker.top}` +
        `/${item.boxes.map((box) => `${box.left},${box.top},${box.width},${box.height}`).join(';')}`,
    )
    .join('|')
}

function sameIds(left: ReadonlySet<string> | null, right: ReadonlySet<string>) {
  if (!left || left.size !== right.size) return false
  for (const id of right) if (!left.has(id)) return false
  return true
}

/**
 * Findings drawn over the page. Markers live in their own absolutely positioned
 * layer, so opening, closing or re-anchoring the evidence panel cannot reflow,
 * resize or push the document: the page is measured and decorated, never
 * inserted into.
 *
 * Every position is read from the rendered page after commit. That is a real
 * browser boundary (layout is browser state, not React state), so the effect is
 * deliberate and its observer is cleaned up.
 */
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
  const lastVisible = useRef<ReadonlySet<string> | null>(null)
  const findings = verification?.findings
  const targets = verification?.targets
  const setVisibleIds = verification?.setVisibleIds

  // Re-measure when the page reflows: zoom, image or font loading, and a
  // re-laid-out document all change the box of the scroll content.
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
    for (const group of groups.values()) {
      const target = targets.get(group[0]!.id)
      if (!target || target.kind !== 'mapped') continue
      const range = rangeForTarget(desk, target)
      if (!range) continue
      // The page, not the stored model, is the last word on whether this range
      // still carries the checked text: an unsaved edit before the range moves
      // it, and a highlight over the wrong words is worse than no highlight.
      if (!group.every((finding) => range.toString() === finding.excerpt))
        continue
      const rects = rectsOfRange(range)
      const last = rects[rects.length - 1]!
      next.push({
        findings: group,
        finding: worstOf(group),
        target,
        boxes: rects.map((rect) => ({
          left: rect.left - originLeft,
          top: rect.top - originTop,
          width: rect.width,
          height: rect.height,
        })),
        // Just clear of the checked text and lifted above the baseline, so the
        // marker does not sit on the words it annotates.
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
    // Only the ids the layer actually drew are "in the document"; the index
    // must not claim a marker that the page did not render.
    const visible = new Set(
      next.flatMap((item) => item.findings.map((finding) => finding.id)),
    )
    if (!sameIds(lastVisible.current, visible)) {
      lastVisible.current = visible
      setVisibleIds?.(visible)
    }
  }, [targets, findings, revision, model, setVisibleIds])

  // Keeping the selection visible must not move the caret: the marker is
  // scrolled, the paragraph editor keeps its selection.
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
            ? `${verificationTypeLabel(item.finding.type)}, ${verificationStateLabel(item.finding.state)}: ${item.finding.authorityLabel} (${item.findings.length} findings here)`
            : `${verificationTypeLabel(item.finding.type)}, ${verificationStateLabel(item.finding.state)}: ${item.finding.authorityLabel}`
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
            title={`${verificationTypeLabel(item.finding.type)}: ${verificationStateLabel(item.finding.state)}`}
            onClick={() => verification.openFinding(item.findings[0]!.id)}
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
