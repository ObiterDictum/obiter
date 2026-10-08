import {
  TRACKED_DECISION_MAX_IDS,
  type DocumentTrackedChangeDecisionRequest,
} from '@obiter/contracts'

import { OoxmlError, type OoxmlDocument, type TrackedChangeNode } from './model'
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
    action === 'accept' ? collectParagraphMarkSiblings(document, requested) : []
  const absorbedIds = new Set(absorbed.map((change) => change.wire.id))
  const pending = uniqueChanges([...requested, ...absorbed]).filter(
    (target) =>
      !target.absorbed &&
      !absorbedIds.has(target.wire.id) &&
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
  // Fold the absorbed siblings only once the decision is accepted: a refused
  // decision must leave the parsed document untouched.
  commitParagraphMarkSiblings(document, absorbed)

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

  const decisionRanges = new Map(
    pending.map((target) => [target, decisionRange(target, action)]),
  )
  for (const target of pending) {
    const part = requireEditablePart(document, target.partName)
    const range = decisionRanges.get(target)
    if (!range) throw invalidDecision()
    setOverlayReplacement(part.overlay, `tracked-change:${target.wire.id}`, {
      start: range.start,
      end: range.end,
      value: decisionReplacement(target, action),
    })
    part.dirty = true
  }

  // A decided move's range markers go too: the containers exist only to group
  // the halves, and orphaned moveFrom/moveToRange markup is residue no
  // consumer should reopen. A marker already covered by a decision or
  // removal range is left to that replacement.
  const cleared = new Set<string>()
  for (const target of uniqueChanges([...requested, ...absorbed])) {
    if (!target.moveMarkers?.length) continue
    const part = requireEditablePart(document, target.partName)
    for (const marker of target.moveMarkers) {
      const key = `${target.partName}:${marker.start}:${marker.end}`
      if (cleared.has(key)) continue
      cleared.add(key)
      if (
        removals.some(
          (removal) =>
            removal.partName === target.partName &&
            marker.start >= removal.start &&
            marker.end <= removal.end,
        ) ||
        pending.some((pendingTarget) => {
          const range = decisionRanges.get(pendingTarget)
          return (
            pendingTarget.partName === target.partName &&
            range !== undefined &&
            marker.start >= range.start &&
            marker.end <= range.end
          )
        })
      ) {
        continue
      }
      setOverlayReplacement(part.overlay, `move-marker:${key}`, {
        start: marker.start,
        end: marker.end,
        value: '',
      })
      part.dirty = true
    }
  }
  return uniqueChanges([...requested, ...absorbed]).map(({ wire }) => wire.id)
}

function resolveTargets(document: OoxmlDocument, changeIds: readonly string[]) {
  if (
    changeIds.length === 0 ||
    changeIds.length > TRACKED_DECISION_MAX_IDS ||
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
      // A move is a named group — several wrappers across several ranges —
      // so deciding any member decides the whole group.
      if (!target.validMoveCounterpart || !target.moveGroup) {
        throw invalidDecision()
      }
      for (const member of document.trackedChanges.values()) {
        if (member.moveGroup !== target.moveGroup) continue
        if (!member.validMoveCounterpart) throw invalidDecision()
        targets.set(member.wire.id, member)
      }
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
    removeParagraphIds.length > TRACKED_DECISION_MAX_IDS ||
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
    // The removal deletes the whole paragraph, so a tracked change inside it
    // that this decision does not name would be destroyed undecided. Refuse
    // rather than let a caller erase pending markup by naming the shell.
    const insideIds = new Set(inside.map((target) => target.wire.id))
    for (const change of document.trackedChanges.values()) {
      if (
        change.partName === anchor.partName &&
        change.range.start >= anchor.paragraphRange.start &&
        change.range.end <= anchor.paragraphRange.end &&
        !insideIds.has(change.wire.id)
      ) {
        throw invalidDecision()
      }
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
  removals: readonly { start: number; end: number }[],
  pending: readonly TrackedChangeNode[],
) {
  const mainStory = document.model.stories.find(
    (story) => story.kind === 'document',
  )
  if (!mainStory) return false
  const mainParagraphIds = new Set(
    mainStory.paragraphs.map((paragraph) => paragraph.id),
  )
  // Every main-part mark-deletion change names the whole `w:p` its mark sits
  // in, including paragraphs the parser excludes from the wire model. They are
  // body paragraphs, so they count.
  const markRanges: Array<{ start: number; end: number }> = []
  let bodyCount = mainStory.paragraphs.length
  for (const change of document.trackedChanges.values()) {
    if (change.partName !== mainStory.partName) continue
    if (!change.paragraphMarkRange) continue
    markRanges.push(change.paragraphMarkRange)
    bodyCount += 1
  }
  // A decision removes whole `w:p` subtrees, so count every main paragraph or
  // mark whose range is contained in a removed range. That catches hosted
  // paragraphs and nested mark-deleted paragraphs inside the removed one, which
  // an id-membership count would miss.
  const removedRanges: Array<{ start: number; end: number }> = removals.map(
    (removal) => ({ start: removal.start, end: removal.end }),
  )
  if (action === 'accept') {
    for (const target of pending) {
      if (target.partName !== mainStory.partName) continue
      if (target.paragraphMarkRange) {
        removedRanges.push(target.paragraphMarkRange)
      }
    }
  }
  const contained = (range: { start: number; end: number }) =>
    removedRanges.some(
      (removed) => range.start >= removed.start && range.end <= removed.end,
    )
  let removed = 0
  for (const anchor of document.paragraphAnchors.values()) {
    if (!mainParagraphIds.has(anchor.wire.id)) continue
    if (contained(anchor.paragraphRange)) removed += 1
  }
  for (const range of markRanges) {
    if (contained(range)) removed += 1
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

/**
 * The changes a paragraph-mark deletion absorbs: changes whose range sits inside
 * the deleted mark's paragraph. Pure: it only collects them, so a decision the
 * guard later refuses leaves the parsed document unchanged. The caller folds
 * them with `commitParagraphMarkSiblings` after the decision is accepted.
 */
function collectParagraphMarkSiblings(
  document: OoxmlDocument,
  accepted: readonly TrackedChangeNode[],
) {
  const absorbed: TrackedChangeNode[] = []
  for (const mark of accepted) {
    const range = mark.paragraphMarkRange
    if (!range) continue
    for (const change of document.trackedChanges.values()) {
      if (change.wire.id === mark.wire.id) continue
      if (change.partName !== mark.partName) continue
      if (change.absorbed) continue
      if (change.range.start < range.start || change.range.end > range.end) {
        continue
      }
      if (absorbed.some((item) => item.wire.id === change.wire.id)) continue
      absorbed.push(change)
    }
  }
  return absorbed
}

function commitParagraphMarkSiblings(
  document: OoxmlDocument,
  absorbed: readonly TrackedChangeNode[],
) {
  for (const change of absorbed) {
    change.absorbed = true
    const part = requireEditablePart(document, change.partName)
    part.overlay.replacements.delete(`tracked-change:${change.wire.id}`)
  }
}

function uniqueChanges(changes: readonly TrackedChangeNode[]) {
  return [
    ...new Map(changes.map((change) => [change.wire.id, change])).values(),
  ]
}

function invalidDecision() {
  return new OoxmlError('invalid-tracked-change-decision')
}
