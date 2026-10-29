import type {
  DocumentModelWire,
  DocumentVersionLineage,
} from '@obiter/contracts'
import {
  PENDING_BASELINE_PREFIX,
  type DraftSlot,
  type DraftState,
} from './document-save-plan'
import { lineageIdentities } from './document-baseline-lineage'

export type SaveBaseline = {
  covered: readonly DraftSlot[]
  sent: DraftState
  fromModel: DocumentModelWire
  fromVersionId?: string
  lineage?: DocumentVersionLineage
  versionId?: string
  versionNumber?: number
  toModel?: DocumentModelWire
}

export function pendingDeleteId(clientId: string) {
  return `${PENDING_BASELINE_PREFIX}delete:${clientId}`
}

export function pendingRunId(clientId: string) {
  return `${PENDING_BASELINE_PREFIX}run:${clientId}`
}

export function pendingDeletedParagraphId(paragraphId: string) {
  return `${PENDING_BASELINE_PREFIX}restore:${paragraphId}`
}

export type RunAddress = { paragraphId: string; runIndex: number }

export function pendingRunAddressId(address: RunAddress) {
  return `${PENDING_BASELINE_PREFIX}run-address:${address.paragraphId}:${String(address.runIndex)}`
}

export function pendingUnresolvedRunId(baseRunId: string) {
  return `${PENDING_BASELINE_PREFIX}run-unresolved:${baseRunId}`
}

export type RunContinuation = {
  address: RunAddress
  runId: string | undefined
  from: number
  to: number
}

export function parsePendingRunAddress(key: string): RunAddress | null {
  const prefix = `${PENDING_BASELINE_PREFIX}run-address:`
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  const at = rest.lastIndexOf(':')
  if (at <= 0) return null
  const paragraphId = rest.slice(0, at)
  const runIndex = Number(rest.slice(at + 1))
  if (!Number.isInteger(runIndex) || runIndex < 0) return null
  return { paragraphId, runIndex }
}

export type SavedIdentities = {
  inserted: Map<string, string>
  insertedRuns: Map<string, string>
  restoredAnchors: Map<string, string>
  restoredBeforeAnchors: Map<string, string>
  paragraphIds: Map<string, string>
  runContinuations: Map<string, RunContinuation[]>
  runReversals: Map<string, string[]>
  paragraphReversals: Map<string, string[]>
  insertReversals: Map<
    string,
    { ooxmlIds: string[]; removeParagraphId: string }
  >
}

export function savedIdentities(baseline: SaveBaseline): SavedIdentities {
  if (!baseline.lineage) return emptyIdentities()
  return lineageIdentities(baseline.lineage, baseline.toModel, baseline)
}

function emptyIdentities(): SavedIdentities {
  return {
    inserted: new Map(),
    insertedRuns: new Map(),
    restoredAnchors: new Map(),
    restoredBeforeAnchors: new Map(),
    paragraphIds: new Map(),
    runContinuations: new Map(),
    runReversals: new Map(),
    paragraphReversals: new Map(),
    insertReversals: new Map(),
  }
}

export function paragraphMapFromLineage(
  lineage: DocumentVersionLineage,
): Map<string, string> {
  return new Map(
    lineage.paragraphs.flatMap((entry) =>
      entry.fromParagraphId && entry.toParagraphId
        ? [[entry.fromParagraphId, entry.toParagraphId] as const]
        : [],
    ),
  )
}

export function sentInsertRunIds(baseline: SaveBaseline) {
  return new Set(
    baseline.sent.inserts.flatMap((insert) =>
      (insert.runs ?? []).map((run) => run.id),
    ),
  )
}

export function remapRecordKeys<T>(
  record: Record<string, T>,
  remap: (id: string) => string,
) {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    next[remap(key)] = value
  }
  return next
}
