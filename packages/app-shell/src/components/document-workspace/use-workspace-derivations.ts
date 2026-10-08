import { useEffect, useMemo } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import {
  extractAuthorities,
  type AuthorityHit,
} from '../../document-authorities'
import { formattedModel } from '../../document-format-edits'
import {
  batchParagraphDeletions,
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
import { pendingImageUrls } from '../../document-image-inserts'
import {
  structuralLinkOverlays,
  type ParagraphLinkOverlay,
} from '../../document-structure-overlays'
import { checkCrossReferences } from '../../document-cross-reference-check'
import { checkDefinedTerms } from '../../document-defined-terms'
import { isGeneratedFieldResultStyle } from '@obiter/ooxml'
import type { TableOfAuthoritiesFacts } from '../../document-legal-toolbar'
import { useDocumentImageUrls } from '../../document-workspace-api'
import type { FormatTarget } from '../../document-format-edits'
import type { useWorkspaceDrafts } from './use-workspace-drafts'
import { useInsertRibbon, type InsertRibbonProps } from './use-insert-ribbon'

const NO_DELETIONS = {
  emptied: new Map<string, string>(),
  applied: new Set<string>(),
  effective: new Set<string>(),
}

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
  /**
   * The stored-markup legal checks: cross-reference fields against the
   * document's bookmarks, and `_Def_` defined-term marks against the body's
   * effective text. `null` while the model is loading.
   */
  legalChecks: {
    references: ReturnType<typeof checkCrossReferences>
    terms: ReturnType<typeof checkDefinedTerms>
  } | null
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
  legalChecksOpen,
}: {
  documentId: string
  model: DocumentModelWire | undefined
  drafts: DraftState
  /**
   * The legal-checks panel's open state: the stored-markup checks are a
   * whole-document scan that only the panel reads, so they run when it is
   * open and report `null` — "checks unavailable" — when it is closed.
   */
  legalChecksOpen: boolean
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
  // The deleted sets the batch resolves to, computed once for every surface:
  // `effective` is what the writer will treat as gone (the applied marks plus
  // the runless paragraphs a pending replacement deletes implicitly), which
  // the structural fold, the Insert ribbon and the authorities index all read;
  // `applied` is only the outright deletes, which the page paint uses because
  // a replaced paragraph still shows its typed text.
  const deletions = useMemo(
    () =>
      model
        ? batchParagraphDeletions(
            model,
            drafts.inserts,
            drafts.deletedParagraphIds,
            drafts.extraRuns,
            drafts.drafts,
          )
        : NO_DELETIONS,
    [
      model,
      drafts.inserts,
      drafts.deletedParagraphIds,
      drafts.extraRuns,
      drafts.drafts,
    ],
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
            deletions.effective,
          )
        : undefined,
    [formatted, drafts.structures, drafts.drafts, deletions],
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
            [...deletions.applied],
            drafts.extraRuns,
          )
        : [],
    [model, drafts.drafts, drafts.inserts, deletions, drafts.extraRuns],
  )
  // The citations a table of authorities captures at the caret: the
  // authority hits the memo above already scans, restricted to stored body
  // paragraphs that survive the effective deletions — the same exclusion
  // the writer's `deletedIds` pass and the generated-result style test
  // keep. Grouped into entries once so the ribbon's disabled reason and
  // the save partition's facts read one answer.
  const toaFacts = useMemo<TableOfAuthoritiesFacts>(() => {
    const story = model ? documentStory(model) : undefined
    if (!story) return { occurrences: [], entries: [], citingWires: [] }
    const wiresById = new Map(
      story.paragraphs.map((paragraph) => [paragraph.id, paragraph]),
    )
    const occurrences = authorities.filter((hit) => {
      const wire = wiresById.get(hit.paragraphId)
      return (
        wire !== undefined &&
        !deletions.effective.has(hit.paragraphId) &&
        !isGeneratedFieldResultStyle(wire.styleId)
      )
    })
    const citingByCitation = new Map<string, string[]>()
    for (const hit of occurrences) {
      const citing = citingByCitation.get(hit.citation) ?? []
      if (!citing.includes(hit.paragraphId)) citing.push(hit.paragraphId)
      citingByCitation.set(hit.citation, citing)
    }
    const entries = [...citingByCitation.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([citation, paragraphIds]) => ({ citation, paragraphIds }))
    const citingIds = new Set(entries.flatMap((entry) => entry.paragraphIds))
    return {
      occurrences,
      entries,
      citingWires: story.paragraphs.filter((paragraph) =>
        citingIds.has(paragraph.id),
      ),
    }
  }, [model, authorities, deletions])
  // Links and field markers carry no model change, so they are grouped into
  // an overlay map here rather than folded like a table. The painted model
  // feeds the marker labels so a reference names the target's current text.
  const linkOverlays = useMemo(
    () => structuralLinkOverlays(painted, drafts.structures),
    [painted, drafts.structures],
  )
  // The legal checks read the stored model plus pending structure — the same
  // paragraphs and fields the save will write — so `effective` deletions are
  // what count as gone, matching the writer's answer. They run only while
  // the panel is open: both checks scan every stored field and `_Def_`
  // bookmark in the document, and nothing else consumes the result.
  const legalChecks = useMemo(
    () =>
      model && legalChecksOpen
        ? {
            references: checkCrossReferences(
              model,
              drafts.structures,
              deletions.effective,
              drafts.drafts,
              drafts.extraRuns,
            ),
            terms: checkDefinedTerms(
              model,
              drafts.structures,
              drafts.inserts,
              deletions.effective,
              drafts.drafts,
              drafts.extraRuns,
            ),
          }
        : null,
    [
      model,
      legalChecksOpen,
      drafts.structures,
      deletions,
      drafts.drafts,
      drafts.extraRuns,
      drafts.inserts,
    ],
  )
  const insertRibbon = useInsertRibbon(
    model,
    painted,
    insert.caret,
    insert.offset,
    insert.trackChanges,
    insert.margin,
    { ...drafts, deletedParagraphIds: deletions.effective },
    toaFacts,
    insert.onImageError,
  )
  return {
    painted,
    pages,
    authorities,
    imageUrls,
    insert: insertRibbon,
    linkOverlays,
    legalChecks,
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
