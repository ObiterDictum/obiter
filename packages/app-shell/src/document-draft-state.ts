import type { LocalInsert } from './document-story-flow'
import type { FormatDrafts } from './document-format-edits'
import type { StructuralDraft } from './document-structural-drafts'
import type { ExtraRuns } from './document-word-edits'

export type BreakDraft = {
  id: string
  paragraphId: string
  offset: number
  kind: 'page' | 'section'
}

export type DraftState = {
  drafts: Record<string, string>
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
  extraRuns: ExtraRuns
  format: FormatDrafts
  breaks: BreakDraft[]
  structures: StructuralDraft[]
  trackedRejections: TrackedRejection[]
}

type TrackedRejection = {
  key: string
  ooxmlIds: string[]
  removeParagraphIds?: string[]
}

export const PENDING_BASELINE_PREFIX = 'pending-baseline:'

export function isPendingBaselineId(id: string) {
  return id.startsWith(PENDING_BASELINE_PREFIX)
}

export function emptyDraftState(): DraftState {
  return {
    drafts: {},
    inserts: [],
    deletedParagraphIds: [],
    extraRuns: {},
    format: {
      emphasis: [],
      paragraphStyles: {},
      numbering: {},
      paragraphFormats: {},
      section: {},
    },
    breaks: [],
    structures: [],
    trackedRejections: [],
  }
}

export type StructureKind = StructuralDraft['kind']

export type DraftSlot =
  | { kind: 'run-text'; key: string; runId: string }
  | { kind: 'extra-runs'; key: string; paragraphId: string }
  | { kind: 'insert'; key: string; clientId: string }
  | { kind: 'delete'; key: string; paragraphId: string }
  | { kind: 'paragraph-style'; key: string; paragraphId: string }
  | { kind: 'numbering'; key: string; paragraphId: string }
  | { kind: 'paragraph-format'; key: string; paragraphId: string }
  | { kind: 'emphasis'; key: string }
  | { kind: 'section'; key: string }
  | { kind: 'break'; key: string; id: string; breakKind: 'page' | 'section' }
  | {
      kind: 'structure'
      key: string
      id: string
      structureKind: StructureKind
    }
  | { kind: 'tracked-reject'; key: string; ooxmlIds: string[] }

export type BlockedDraft = {
  slot: DraftSlot
  reason: string
  label: string
}
