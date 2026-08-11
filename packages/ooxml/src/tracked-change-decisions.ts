import type { DocumentTrackedChangeDecisionRequest } from '@obiter/contracts'

import { OoxmlError, type OoxmlDocument, type TrackedChangeNode } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { setOverlayReplacement } from './parts/overlay'

export function applyTrackedChangeDecisions(
  document: OoxmlDocument,
  changeIds: readonly string[],
  action: DocumentTrackedChangeDecisionRequest['action'],
) {
  const targets = resolveTargets(document, changeIds)
  validateTargets(targets)

  for (const target of targets) {
    const part = requireEditablePart(document, target.partName)
    const range =
      target.wire.kind === 'property' && action === 'reject'
        ? target.parentRange
        : target.range
    if (!range) throw invalidDecision()
    setOverlayReplacement(part.overlay, `tracked-change:${target.wire.id}`, {
      start: range.start,
      end: range.end,
      value: decisionReplacement(target, action),
    })
    part.dirty = true
  }
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

function validateTargets(targets: readonly TrackedChangeNode[]) {
  for (const target of targets) {
    if (
      target.wire.kind === 'property' &&
      (!target.parentRange || !target.previousPropertiesFragment)
    ) {
      throw invalidDecision()
    }
  }

  const ordered = [...targets].sort(
    (left, right) =>
      left.partName.localeCompare(right.partName) ||
      left.range.start - right.range.start,
  )
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    if (
      previous &&
      current &&
      previous.partName === current.partName &&
      current.range.start < previous.range.end
    ) {
      throw invalidDecision()
    }
  }
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
  const replacements = target.deletedTextElements
    .map(({ range, qualifiedName }) => {
      const prefix = qualifiedName.includes(':')
        ? `${qualifiedName.slice(0, qualifiedName.indexOf(':'))}:`
        : ''
      return [
        {
          start: range.start - target.range.startTagEnd,
          end: range.startTagEnd - target.range.startTagEnd,
          value: target.innerFragment
            .slice(
              range.start - target.range.startTagEnd,
              range.startTagEnd - target.range.startTagEnd,
            )
            .replace(qualifiedName, `${prefix}t`),
        },
        ...(range.endTagStart < range.end
          ? [
              {
                start: range.endTagStart - target.range.startTagEnd,
                end: range.end - target.range.startTagEnd,
                value: `</${prefix}t>`,
              },
            ]
          : []),
      ]
    })
    .flat()
    .sort((left, right) => left.start - right.start)

  let cursor = 0
  let result = ''
  for (const replacement of replacements) {
    result += target.innerFragment.slice(cursor, replacement.start)
    result += replacement.value
    cursor = replacement.end
  }
  return result + target.innerFragment.slice(cursor)
}

function invalidDecision() {
  return new OoxmlError('invalid-tracked-change-decision')
}
