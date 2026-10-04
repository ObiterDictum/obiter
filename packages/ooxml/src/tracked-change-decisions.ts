import type { DocumentTrackedChangeDecisionRequest } from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TrackedChangeNode,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { renameFragmentElements, setOverlayReplacement } from './parts/overlay'

export function applyTrackedChangeDecisions(
  document: OoxmlDocument,
  changeIds: readonly string[],
  action: DocumentTrackedChangeDecisionRequest['action'],
  removeParagraphIds: readonly string[] = [],
) {
  const requested = resolveTargets(document, changeIds)
  const removals =
    action === 'reject'
      ? resolveRemovalParagraphs(document, requested, removeParagraphIds)
      : []
  const absorbed =
    action === 'accept' ? absorbParagraphMarkSiblings(document, requested) : []
  const pending = uniqueChanges([...requested, ...absorbed]).filter(
    (target) =>
      !target.absorbed &&
      !removals.some(
        (removal) =>
          removal.partName === target.partName &&
          target.range.start >= removal.start &&
          target.range.end <= removal.end,
      ),
  )
  validateTargets(pending, action)
  if (wouldRemoveLastParagraph(document, action, removals, pending)) {
    throw new OoxmlError('last-paragraph-required')
  }

  // Remove the shells first: each covers a whole paragraph, and any change
  // inside it is dropped from `pending`, so the two overlays never overlap.
  for (const removal of removals) {
    const part = requireEditablePart(document, removal.partName)
    setOverlayReplacement(
      part.overlay,
      `${removal.anchor.wire.id}:decision-remove`,
      { start: removal.start, end: removal.end, value: '' },
    )
    part.dirty = true
    const story = document.model.stories.find((item) =>
      item.paragraphs.includes(removal.anchor.wire),
    )
    if (story) {
      story.paragraphs.splice(story.paragraphs.indexOf(removal.anchor.wire), 1)
    }
  }

  for (const target of pending) {
    const part = requireEditablePart(document, target.partName)
    const range = decisionRange(target, action)
    if (!range) throw invalidDecision()
    setOverlayReplacement(part.overlay, `tracked-change:${target.wire.id}`, {
      start: range.start,
      end: range.end,
      value: decisionReplacement(target, action),
    })
    part.dirty = true
  }
  return uniqueChanges([...requested, ...absorbed]).map(({ wire }) => wire.id)
}

function resolveTargets(document: OoxmlDocument, changeIds: readonly string[]) {
  if (
    changeIds.length === 0 ||
    changeIds.length > 100 ||
    new Set(changeIds).size !== changeIds.length
  ) {
    throw invalidDecision()
  }

  const targets = new Map<string, TrackedChangeNode>()
  for (const id of changeIds) {
    const target = document.trackedChanges.get(id)
    if (!target) throw invalidDecision()
    targets.set(target.wire.id, target)
    if (target.wire.kind === 'move') {
      if (!target.validMoveCounterpart || !target.wire.pairId) {
        throw invalidDecision()
      }
      const counterpart = document.trackedChanges.get(target.wire.pairId)
      if (!counterpart?.validMoveCounterpart) throw invalidDecision()
      targets.set(counterpart.wire.id, counterpart)
    }
  }
  return [...targets.values()]
}

/**
 * Resolves the empty shells a rejection removes. A removal is only valid when
 * it is one requested `w:ins` target's own paragraph: the paragraph parses
 * with no visible run (its content is entirely tracked-insert), and every
 * requested target inside it is that insertion. That refuses a decision that
 * would delete a paragraph carrying any untracked content.
 */
function resolveRemovalParagraphs(
  document: OoxmlDocument,
  requested: readonly TrackedChangeNode[],
  removeParagraphIds: readonly string[],
) {
  if (removeParagraphIds.length === 0) return []
  if (
    removeParagraphIds.length > 100 ||
    new Set(removeParagraphIds).size !== removeParagraphIds.length
  ) {
    throw invalidDecision()
  }
  const removals: Array<{
    anchor: NonNullable<ReturnType<typeof anchorFor>>
    partName: string
    start: number
    end: number
  }> = []
  for (const paragraphId of removeParagraphIds) {
    const anchor = anchorFor(document, paragraphId)
    if (!anchor) throw invalidDecision()
    // A shell whose visible content is entirely tracked-insert parses to no
    // runs. Anything else would mean deleting untracked content.
    if (anchor.runs.length > 0) throw invalidDecision()
    const inside = requested.filter(
      (target) =>
        target.partName === anchor.partName &&
        target.range.start >= anchor.paragraphRange.start &&
        target.range.end <= anchor.paragraphRange.end,
    )
    if (inside.length === 0) throw invalidDecision()
    if (!inside.every((target) => target.wire.kind === 'insert')) {
      throw invalidDecision()
    }
    removals.push({
      anchor,
      partName: anchor.partName,
      start: anchor.paragraphRange.start,
      end: anchor.paragraphRange.end,
    })
  }
  return removals
}

function anchorFor(document: OoxmlDocument, paragraphId: string) {
  return document.paragraphAnchors.get(paragraphId)
}

/**
 * Whether this decision would leave the main body with no paragraph. A tracked
 * deletion keeps the paragraph mark as deleted markup, but accepting that mark
 * (or rejecting the last tracked-insert shell) removes the whole `w:p`, so the
 * persisted body must keep at least one paragraph. The count adds paragraphs
 * the parser excludes because their mark is already deleted, so a reject that
 * restores one is not mistaken for a removal. This is the same typed refusal
 * the edit guard uses, not a second paragraph-count rule.
 */
function wouldRemoveLastParagraph(
  document: OoxmlDocument,
  action: DocumentTrackedChangeDecisionRequest['action'],
  removals: readonly { anchor: ParagraphAnchor }[],
  pending: readonly TrackedChangeNode[],
) {
  const mainStory = document.model.stories.find(
    (story) => story.kind === 'document',
  )
  if (!mainStory) return false
  const mainParagraphIds = new Set(
    mainStory.paragraphs.map((paragraph) => paragraph.id),
  )
  let bodyCount = mainStory.paragraphs.length
  for (const change of document.trackedChanges.values()) {
    if (change.partName === mainStory.partName && change.paragraphMarkRange) {
      bodyCount += 1
    }
  }
  let removed = 0
  for (const removal of removals) {
    if (mainParagraphIds.has(removal.anchor.wire.id)) removed += 1
  }
  if (action === 'accept') {
    for (const target of pending) {
      if (target.partName === mainStory.partName && target.paragraphMarkRange) {
        removed += 1
      }
    }
  }
  return bodyCount - removed < 1
}

function validateTargets(
  targets: readonly TrackedChangeNode[],
  action: DocumentTrackedChangeDecisionRequest['action'],
) {
  for (const target of targets) {
    if (
      target.wire.kind === 'property' &&
      (!target.propertiesRange || !target.previousPropertiesFragment)
    ) {
      throw invalidDecision()
    }
  }

  const ordered = [...targets].sort((left, right) => {
    const leftRange = decisionRange(left, action)
    const rightRange = decisionRange(right, action)
    return (
      left.partName.localeCompare(right.partName) ||
      (leftRange?.start ?? 0) - (rightRange?.start ?? 0)
    )
  })
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    const previousRange = previous ? decisionRange(previous, action) : undefined
    const currentRange = current ? decisionRange(current, action) : undefined
    if (
      previous &&
      current &&
      previousRange &&
      currentRange &&
      previous.partName === current.partName &&
      currentRange.start < previousRange.end
    ) {
      throw invalidDecision()
    }
  }
}

function decisionRange(
  target: TrackedChangeNode,
  action: DocumentTrackedChangeDecisionRequest['action'],
) {
  if (target.wire.kind === 'property' && action === 'reject') {
    return target.propertiesRange
  }
  if (action === 'accept' && target.paragraphMarkRange) {
    return target.paragraphMarkRange
  }
  return target.range
}

function decisionReplacement(
  target: TrackedChangeNode,
  action: DocumentTrackedChangeDecisionRequest['action'],
) {
  if (target.wire.kind === 'insert') {
    return action === 'accept' ? target.innerFragment : ''
  }
  if (target.wire.kind === 'delete') {
    return action === 'accept' ? '' : restoreDeletedText(target)
  }
  if (target.wire.kind === 'move') {
    if (target.wire.direction === 'from') {
      return action === 'accept' ? '' : restoreDeletedText(target)
    }
    return action === 'accept' ? target.innerFragment : ''
  }
  return action === 'accept' ? '' : (target.previousPropertiesFragment ?? '')
}

function restoreDeletedText(target: TrackedChangeNode) {
  const restored = renameFragmentElements(
    target.innerFragment,
    target.range.startTagEnd,
    target.deletedTextElements,
    't',
  )
  if (restored === undefined) throw invalidDecision()
  return restored
}

function absorbParagraphMarkSiblings(
  document: OoxmlDocument,
  accepted: readonly TrackedChangeNode[],
) {
  const absorbed: TrackedChangeNode[] = []
  for (const mark of accepted) {
    const range = mark.paragraphMarkRange
    if (!range) continue
    const part = requireEditablePart(document, mark.partName)
    for (const change of document.trackedChanges.values()) {
      if (change.wire.id === mark.wire.id) continue
      if (change.partName !== mark.partName) continue
      if (change.absorbed) continue
      if (change.range.start < range.start || change.range.end > range.end) {
        continue
      }
      change.absorbed = true
      part.overlay.replacements.delete(`tracked-change:${change.wire.id}`)
      absorbed.push(change)
    }
  }
  return absorbed
}

function uniqueChanges(changes: readonly TrackedChangeNode[]) {
  return [
    ...new Map(changes.map((change) => [change.wire.id, change])).values(),
  ]
}

function invalidDecision() {
  return new OoxmlError('invalid-tracked-change-decision')
}
