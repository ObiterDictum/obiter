import type { StructuralDraft } from './document-structural-drafts'

export function pendingTableIdentities(
  draft: StructuralDraft & { kind: 'table' },
) {
  const identity = (slot: string) => {
    let hash = 2166136261
    for (const char of `${draft.id}:${slot}`) {
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    }
    return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
  }
  const cellParaIds =
    draft.cellParaIds ??
    Array.from({ length: draft.rows * draft.columns }, (_, index) =>
      identity(String(index)),
    )
  const separatorId = identity('separator')
  const tailId = identity('tail')
  const identities = [...cellParaIds, separatorId, tailId]
  if (
    cellParaIds.length !== draft.rows * draft.columns ||
    new Set(identities).size !== identities.length
  )
    throw new Error('Invalid pending table paragraph identities')
  return { cellParaIds, separatorId, tailId }
}
