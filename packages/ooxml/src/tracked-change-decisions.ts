import type { DocumentTrackedChangeDecisionRequest } from '@obiter/contracts'

import { OoxmlError, type OoxmlDocument, type TrackedChangeNode } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { renameFragmentElements, setOverlayReplacement } from './parts/overlay'

export function applyTrackedChangeDecisions(
  document: OoxmlDocument,
  changeIds: readonly string[],
  action: DocumentTrackedChangeDecisionRequest['action'],
) {
  const requested = resolveTargets(document, changeIds)
  const absorbed =
    action === 'accept' ? absorbParagraphMarkSiblings(document, requested) : []
  const pending = uniqueChanges([...requested, ...absorbed]).filter(
    (target) => !target.absorbed,
  )
  validateTargets(pending, action)

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
