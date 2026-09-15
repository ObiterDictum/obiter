import { useEffect, useId, useRef, useState } from 'react'
import { CaretLeft, CaretRight, X } from '@phosphor-icons/react'
import {
  Badge,
  Button,
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
} from '@obiter/ui'
import type { VerificationFindingView } from '@obiter/contracts'
import {
  useVerificationWorkspace,
  type VerificationWorkspaceValue,
} from './verification-context'
import type { UnmappedReason } from './verification-mapping'
import {
  verificationReasonLabel,
  verificationStateLabel,
  verificationStateTone,
  verificationStoredVersionNote,
  verificationStoryLabel,
  verificationTypeLabel,
  verificationUnmappedLabel,
} from '../../verification-copy'

/**
 * The contextual evidence panel. It floats above the document page in a
 * non-modal popover: no focus trap, no scroll lock, no backdrop, so the page
 * behind it stays readable and scrollable while a reviewer reads the evidence.
 *
 * It never renders stored source text or HTML: a source is shown by identity,
 * and the checked stored version is always named.
 */
export function VerificationEvidencePanel() {
  const verification = useVerificationWorkspace()
  const titleId = useId()
  const latest = useRef(verification)
  latest.current = verification
  const activeId = verification?.activeId ?? null
  const finding =
    verification?.findings.find((item) => item.id === activeId) ?? null
  const anchor = finding
    ? (verification?.markerFor(finding.id) ?? verification?.dockAnchor ?? null)
    : null
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

  // Dismissal outside the panel is one rule for both placements, and it never
  // moves focus. Escape is the same rule for every focus position, including a
  // marker that never took focus, and it restores focus to what opened the
  // panel. Document-level listeners are a browser boundary with cleanup.
  const panelOpen = verification?.panelOpen ?? false
  const indexOpen = verification?.indexOpen ?? false
  useEffect(() => {
    // While the modal findings index is open it owns dismissal: it is not
    // "outside" the panel, and Escape belongs to the dialog. Registering the
    // listeners only outside the index keeps one Escape from closing two
    // surfaces.
    if (!panelOpen || indexOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      // The panel, the markers and the document-level control are all part of
      // the same interaction: a click there retargets it, it does not dismiss.
      if (
        target.closest(
          '[data-verification-panel],[data-verification-marker],[data-verification-controls]',
        )
      ) {
        return
      }
      latest.current?.closePanel()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      latest.current?.closePanel()
      anchorRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [panelOpen, indexOpen])

  if (!verification?.panelOpen || !finding) return null
  const total = verification.totalFindings
  const close = (restoreFocus: boolean) => {
    verification.closePanel()
    if (restoreFocus) anchor?.focus()
  }
  const body = (
    <PanelBody
      key={finding.id}
      finding={finding}
      titleId={titleId}
      position={`${verification.activeIndex + 1} of ${total}`}
      storedVersionNote={verificationStoredVersionNote(
        verification.checkedVersionId ?? 'unknown',
        { unsaved: verification.dirty, stale: verification.stale },
      )}
      unmappedReason={unmappedReasonFor(verification, finding)}
      canGoPrevious={verification.activeIndex > 0}
      canGoNext={verification.activeIndex < total - 1}
      onPrevious={() => verification.step(-1)}
      onNext={() => verification.step(1)}
      onClose={() => close(true)}
      onEscape={() => close(true)}
    />
  )

  if (verification.placement === 'drawer') {
    return (
      <div
        data-verification-panel
        data-placement="drawer"
        role="dialog"
        aria-modal={false}
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-xl border-t border-line bg-raised px-4 pt-3 pb-6 shadow-lg"
      >
        {body}
      </div>
    )
  }

  return (
    <Popover
      open
      onOpenChange={(open, details) => {
        if (open) return
        // The panel owns its dismissal. Base UI's dismissals are cancelled and
        // the document listener below performs the one rule (a real click
        // outside the panel, markers or controls, or Escape, both restoring
        // focus). Without this, opening the modal findings index counts as an
        // outside press and silently destroys the panel it was opened from.
        details.cancel()
      }}
    >
      <PopoverPortal>
        <PopoverPositioner
          anchor={anchor ?? undefined}
          side="top"
          align="start"
          sideOffset={10}
        >
          <PopoverPopup
            data-verification-panel
            data-placement="floating"
            role="dialog"
            aria-modal={false}
            aria-labelledby={titleId}
            className="w-[24rem] max-w-[90vw] p-4"
          >
            {body}
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}

/**
 * Why the page did not draw this finding. A stored-model mapping that the page
 * did not render is reported with the renderer's own reason: a hard break, a
 * range split across fragments, or an anchor the page did not paint are not
 * changes to the document's text.
 */
function unmappedReasonFor(
  verification: VerificationWorkspaceValue,
  finding: VerificationFindingView,
): UnmappedReason | null {
  if (!verification.mappable) return 'document_not_mappable'
  const target = verification.targets.get(finding.id)
  if (target?.kind === 'unmapped') return target.reason
  if (target?.kind !== 'mapped') return null
  if (!verification.rendered) return null
  if (verification.rendered.visibleIds.has(finding.id)) return null
  return (
    verification.rendered.reasons.get(finding.id) ?? 'text_changed_since_check'
  )
}

function PanelBody({
  finding,
  titleId,
  position,
  storedVersionNote,
  unmappedReason,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onClose,
  onEscape,
}: {
  finding: VerificationFindingView
  titleId: string
  position: string
  storedVersionNote: string
  unmappedReason: ReturnType<typeof unmappedReasonFor>
  canGoPrevious: boolean
  canGoNext: boolean
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
  onEscape: () => void
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  return (
    <div
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.stopPropagation()
        onEscape()
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="truncate text-sm font-semibold text-ink">
            {finding.authorityLabel}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{verificationTypeLabel(finding.type)}</Badge>
            <Badge tone={verificationStateTone(finding.state)}>
              {verificationStateLabel(finding.state)}
            </Badge>
            {verificationStoryLabel(finding.location.storyKind) ? (
              <Badge tone="neutral">
                {verificationStoryLabel(finding.location.storyKind)}
              </Badge>
            ) : null}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Close evidence"
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </Button>
      </div>

      <p className="text-sm text-ink">{finding.explanation}</p>
      <p className="font-mono text-xs break-all text-subtle">
        {finding.excerpt}
      </p>

      {unmappedReason ? (
        <p className="text-xs text-warning" role="note">
          {verificationUnmappedLabel(unmappedReason)}
        </p>
      ) : null}
      {finding.reviewReason ? (
        <p className="text-xs text-muted">
          {verificationReasonLabel(finding.reviewReason)}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-xs text-subtle">{position}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous finding"
            disabled={!canGoPrevious}
            onClick={onPrevious}
          >
            <CaretLeft size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next finding"
            disabled={!canGoNext}
            onClick={onNext}
          >
            <CaretRight size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEvidenceOpen((value) => !value)}
          >
            {evidenceOpen ? 'Hide evidence' : 'View evidence'}
          </Button>
        </div>
      </div>

      {evidenceOpen ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {finding.evidence.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {finding.evidence.map((item) => (
                <li key={item.id} className="text-xs text-muted">
                  {item.label}
                  <span className="mt-0.5 block font-mono text-[11px] break-all text-subtle">
                    {item.id}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No source evidence attached.</p>
          )}
          <p className="text-xs text-subtle">{storedVersionNote}</p>
        </div>
      ) : (
        <p className="text-xs text-subtle">{storedVersionNote}</p>
      )}
    </div>
  )
}
