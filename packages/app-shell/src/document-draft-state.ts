import type { BreakDraft, LocalInsert } from './document-edits'
import type { FormatDrafts } from './document-format-edits'
import type { StructuralDraft } from './document-structural-drafts'
import type { ExtraRuns } from './document-word-edits'

/**
 * The draft state that a save request is derived from. Kept apart from
 * `document-save-plan.ts`, which is at its source ceiling carrying the
 * planner alone; every slot kind the plan covers is declared here.
 */
export type DraftState = {
  drafts: Record<string, string>
  inserts: LocalInsert[]
  deletedParagraphIds: string[]
  extraRuns: ExtraRuns
  format: FormatDrafts
  /** Page and section breaks held before save, caret-anchored per paragraph. */
  breaks: BreakDraft[]
  /** Table and image insertions held before save, anchored to a stored
   * paragraph. They are folded into the painted model, not the editable
   * flow — a pending table's cell paragraphs are never typed into. */
  structures: StructuralDraft[]
  /**
   * Tracked changes a saved edit left behind, grouped by the history step that
   * created them. A tracked text replacement removes its run from the reparsed
   * model, so its reversal is a tracked-change rejection addressed by persisted
   * `w:id`, never a run id. Each group is rejected as one unit.
   */
  trackedRejections: TrackedRejection[]
}

/** One history step's tracked changes, rejected together. */
export type TrackedRejection = {
  /** Stable key for clearing/looking up this group. */
  key: string
  /** Persisted OOXML change ids (`w:id`) to reject as a unit. */
  ooxmlIds: string[]
  /**
   * Persisted paragraph ids (`para-w14-<value>`) whose empty tracked-insert
   * shell this rejection removes in the same decision. A tracked paragraph
   * insertion wraps its content in `w:ins`, so rejecting it alone would leave
   * an empty paragraph behind.
   */
  removeParagraphIds?: string[]
}

/**
 * A structural reversal a save boundary has not been able to address yet,
 * because the reloaded model has not named the paragraph it created or removed.
 * It is not user work: the planner never sends it and never reports it blocked,
 * and the boundary resolves it to a real identity when the model arrives. See
 * `document-history-baseline.ts`.
 */
export const PENDING_BASELINE_PREFIX = 'pending-baseline:'

export function isPendingBaselineId(id: string) {
  return id.startsWith(PENDING_BASELINE_PREFIX)
}

/**
 * A fresh draft state. `format` is built here rather than reused from
 * `emptyFormatDrafts`: planDocumentSave fills a copy in place, so sharing the
 * module singleton would leak one workspace's paragraph styles into every
 * other one.
 */
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

/**
 * A named region of draft state. Slots are the unit of clearing after a save
 * and of discarding a change the server will not accept.
 */
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
      structureKind:
        'table' | 'image' | 'link' | 'cross-reference' | 'page-number'
    }
  | { kind: 'tracked-reject'; key: string; ooxmlIds: string[] }

export type BlockedDraft = {
  slot: DraftSlot
  reason: string
  label: string
}
