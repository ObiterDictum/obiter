import { useEffect, useMemo } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import {
  extractAuthorities,
  type AuthorityHit,
} from '../../document-authorities'
import { formattedModel } from '../../document-format-edits'
import {
  LAST_NOTE_PARAGRAPH_MESSAGE,
  LAST_PARAGRAPH_MESSAGE,
  PENDING_STRUCTURE_MESSAGE,
  paragraphDeletionRefusal,
  storyFlowParagraphIds,
  type LocalInsert,
} from '../../document-edits'
import { documentStory, editableParagraph } from '../../document-model-text'
import { withBreakDrafts } from '../../document-section-format'
import { layoutDocument, type LaidOutPage } from '../../document-page-engine'
import { storyBlocks } from '../../document-page-tables'
import { documentImagePartNames } from '../../document-page-media'
import { withStructuralDrafts } from '../../document-structure-fold'
import {
  pendingImageUrls,
  structuralLinkOverlays,
  type ParagraphLinkOverlay,
} from '../../document-structural-drafts'
import { useDocumentImageUrls } from '../../document-workspace-api'
import type { FormatTarget } from '../../document-format-edits'
import type { useWorkspaceDrafts } from './use-workspace-drafts'
import { useInsertRibbon, type InsertRibbonProps } from './use-insert-ribbon'

type DraftState = Pick<
  ReturnType<typeof useWorkspaceDrafts>,
  | 'drafts'
  | 'inserts'
  | 'extraRuns'
  | 'format'
  | 'deletedParagraphIds'
  | 'breaks'
  | 'structures'
  | 'setBreaks'
  | 'setStructures'
>

/**
 * The workspace's derived document artefacts: the painted model, its
 * pagination, the authority index and the document's image URLs.
 *
 * Every one of these is a full pass over the document — `formattedModel`
 * rebuilds every paragraph, `layoutDocument` re-wraps and repaginates every
 * line (measuring each through the canvas), `documentImagePartNames` scans every
 * paragraph's XML and `extractAuthorities` scans the whole flow. They are pure
 * functions of the model and the draft state, but the workspace re-renders
 * several times per keystroke and again whenever a query settles, presence
 * updates or a panel toggles. Recomputing them inline on every render meant a
 * 500-paragraph document was repaginated 4.3 times per keystroke and 12 times
 * when the document opened, and the large majority of those passes ran on input
 * that had not changed.
 *
 * Memoising on the values each function actually reads makes a re-render that
 * changes nothing document-related cost nothing document-related. The draft
 * state keeps its identity unless the field it holds changes, so a keystroke
 * repaginates exactly once and a render that arrives unchanged resolves to the
 * previous pages.
 */
export type WorkspaceDerivations = {
  painted: DocumentModelWire | undefined
  pages: LaidOutPage[]
  authorities: AuthorityHit[]
  imageUrls: Record<string, string>
  /** Set when the effective document holds one paragraph, so Delete paragraph
   * can explain why it is unavailable. `flowParagraphIds` is the same
   * derivation the deletion operation and the save plan use. */
  deleteParagraphReason: string | undefined
  /** The Insert ribbon's break and structural controls. */
  insert: InsertRibbonProps
  /**
   * Pending hyperlink ranges and cross-reference markers, grouped by the
   * paragraph they paint over, in painted-text offsets.
   */
  linkOverlays: ReadonlyMap<string, ParagraphLinkOverlay>
}

/** The disabled reason Delete paragraph shows for `paragraphId`, or undefined
 * when the deletion is allowed. The refusal names a last-paragraph invariant;
 * a paragraph the stored model does not claim and no pending insert owns —
 * a folded table or note paragraph — belongs to a pending structure and is
 * removed with that insertion instead. */
function deleteReasonForParagraph(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
  paragraphId: string,
): string | undefined {
  const refusal = paragraphDeletionRefusal(
    model,
    inserts,
    deletedParagraphIds,
    paragraphId,
  )
  if (refusal === 'last-note-paragraph') return LAST_NOTE_PARAGRAPH_MESSAGE
  if (refusal === 'last-paragraph') return LAST_PARAGRAPH_MESSAGE
  if (
    !editableParagraph(model, paragraphId) &&
    !inserts.some((insert) => insert.clientId === paragraphId)
  ) {
    return PENDING_STRUCTURE_MESSAGE
  }
  return undefined
}

export function useWorkspaceDerivations({
  documentId,
  model,
  drafts,
  insert,
}: {
  documentId: string
  model: DocumentModelWire | undefined
  drafts: DraftState
  /** The caret state the Insert ribbon's availability derives from. */
  insert: {
    caret: FormatTarget
    offset: number | null
    trackChanges: boolean
    onImageError: (message: string) => void
    /** The story open for editing — the margin controls' pressed state and
     * the story the last-paragraph rule is measured on. Undefined means the
     * body. */
    editingStory?: DocumentStoryWire
    /** The paragraph Delete paragraph targets — the caret's owner — so its
     * disabled reason can name the invariant that refuses it, including a
     * note entry's last paragraph inside a story that keeps others. */
    paragraphId: string | null
    margin: {
      editingKind: 'document' | 'header' | 'footer' | 'footnotes'
      onOpen: (
        kind: 'header' | 'footer' | 'footnotes',
        selectId?: string,
      ) => void
      onClose: () => void
    }
  }
}): WorkspaceDerivations {
  const formatted = useMemo(
    () => (model ? formattedModel(model, drafts.format) : undefined),
    [model, drafts.format],
  )
  // Pending tables and pictures fold into the painted model through the same
  // wire mutations — and the same `structure-xml` builders — the save writers
  // produce, so `storyBlocks`, `paragraphImageXml` and `PageDrawing` render
  // them through the code a reloaded document uses. With no pending
  // structures the fold returns `formatted` unchanged, so a keystroke keeps
  // the block partition memoised below.
  const painted = useMemo(
    () =>
      formatted
        ? withStructuralDrafts(
            formatted,
            drafts.structures,
            drafts.drafts,
            new Set(drafts.deletedParagraphIds),
          )
        : undefined,
    [formatted, drafts.structures, drafts.drafts, drafts.deletedParagraphIds],
  )
  // The story's block partition is a pure function of the painted model, so it
  // is scanned once per model rather than once per pagination pass.
  const blocks = useMemo(() => {
    const story = painted ? documentStory(painted) : undefined
    return story ? storyBlocks(story) : []
  }, [painted])
  // Pending breaks are structure, not text: they are folded into a copy of the
  // painted model so pagination sees the same page and section breaks the save
  // will write, without changing what the page renders.
  const broken = useMemo(
    () => (painted ? withBreakDrafts(painted, drafts.breaks) : undefined),
    [painted, drafts.breaks],
  )
  const pages = useMemo(
    () =>
      broken
        ? layoutDocument(
            broken,
            drafts.drafts,
            drafts.inserts,
            drafts.extraRuns,
            blocks,
            drafts.breaks,
          )
        : [],
    [
      broken,
      blocks,
      drafts.drafts,
      drafts.inserts,
      drafts.extraRuns,
      drafts.breaks,
    ],
  )
  const imageParts = useMemo(
    () => (model ? documentImagePartNames(model) : []),
    [model],
  )
  const fetchedImageUrls = useDocumentImageUrls(documentId, imageParts)
  // A pending picture's bytes live in the draft, not the package: its blob URL
  // is keyed by the pending part name the folded relationship resolves to.
  const pendingUrls = useMemo(
    () => pendingImageUrls(drafts.structures),
    [drafts.structures],
  )
  useEffect(() => {
    const created = pendingUrls
    return () => {
      for (const url of Object.values(created)) URL.revokeObjectURL(url)
    }
  }, [pendingUrls])
  const imageUrls = useMemo(
    () => ({ ...fetchedImageUrls, ...pendingUrls }),
    [fetchedImageUrls, pendingUrls],
  )
  const authorities = useMemo(
    () =>
      model
        ? extractAuthorities(
            model,
            drafts.drafts,
            drafts.inserts,
            drafts.deletedParagraphIds,
            drafts.extraRuns,
          )
        : [],
    [
      model,
      drafts.drafts,
      drafts.inserts,
      drafts.deletedParagraphIds,
      drafts.extraRuns,
    ],
  )
  // Links and field markers carry no model change, so they are grouped into
  // an overlay map here rather than folded like a table. The painted model
  // feeds the marker labels so a reference names the target's current text.
  const linkOverlays = useMemo(
    () => structuralLinkOverlays(painted, drafts.structures),
    [painted, drafts.structures],
  )
  const insertRibbon = useInsertRibbon(
    model,
    painted,
    insert.caret,
    insert.offset,
    insert.trackChanges,
    insert.margin,
    drafts,
    insert.onImageError,
  )
  return {
    painted,
    pages,
    authorities,
    imageUrls,
    insert: insertRibbon,
    linkOverlays,
    deleteParagraphReason:
      model && insert.paragraphId
        ? deleteReasonForParagraph(
            model,
            drafts.inserts,
            drafts.deletedParagraphIds,
            insert.paragraphId,
          )
        : model &&
            storyFlowParagraphIds(
              insert.editingStory ?? documentStory(model),
              drafts.inserts,
              drafts.deletedParagraphIds,
            ).length <= 1
          ? LAST_PARAGRAPH_MESSAGE
          : undefined,
  }
}
