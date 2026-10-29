import type { SavePlan } from '../../document-save-plan'
import {
  buildPendingRedlines,
  type PendingRedlines,
} from '../../document-pending-redlines'
import { useEffect, useMemo } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import {
  extractAuthorities,
  type AuthorityHit,
} from '../../document-authorities'
import { formattedModel } from '../../document-format-edits'
import {
  batchParagraphDeletions,
  FIELD_BOUNDARY_MESSAGE,
  FIELD_METADATA_MESSAGE,
  LAST_NOTE_PARAGRAPH_MESSAGE,
  LAST_PARAGRAPH_MESSAGE,
  PENDING_STRUCTURE_MESSAGE,
  paragraphDeletionRefusal,
  storyFlowParagraphIds,
  type LocalInsert,
} from '../../document-edits'
import { documentStory, editableParagraph } from '../../document-model-text'
import { withBreakDrafts } from '../../document-section-format'
import {
  layoutDocument,
  type DocumentLayoutFlow,
  type LaidOutPage,
} from '../../document-page-engine'
import {
  documentSections,
  pageBoxForSection,
  type PageBox,
} from '../../document-page-layout'
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
import type { TableOfAuthoritiesFacts } from '../../document-legal-toolbar'
import { createTableOfAuthoritiesFacts } from '../../document-toa-availability'
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
  | 'state'
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

export type WorkspaceDerivations = {
  painted: DocumentModelWire | undefined
  pendingRedlines: PendingRedlines | undefined
  pages: LaidOutPage[]
  printBox: PageBox | undefined
  authorities: AuthorityHit[]
  imageUrls: Record<string, string>
  deleteParagraphReason: string | undefined
  insert: InsertRibbonProps
  linkOverlays: ReadonlyMap<string, ParagraphLinkOverlay>
  legalChecks: {
    references: ReturnType<typeof checkCrossReferences>
    terms: ReturnType<typeof checkDefinedTerms>
  } | null
}

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
  if (refusal === 'field-boundary') return FIELD_BOUNDARY_MESSAGE
  if (refusal === 'field-metadata') return FIELD_METADATA_MESSAGE
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
  flow,
  saveOperations,
}: {
  saveOperations?: SavePlan['operations']
  documentId: string
  model: DocumentModelWire | undefined
  drafts: DraftState
  flow?: DocumentLayoutFlow
  legalChecksOpen: boolean
  insert: {
    caret: FormatTarget
    offset: number | null
    trackChanges: boolean
    onImageError: (message: string) => void
    editingStory?: DocumentStoryWire
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
  const structured = useMemo(
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
  const painted = structured
  const pendingRedlines = useMemo(
    () =>
      structured && model && insert.trackChanges
        ? buildPendingRedlines(model, drafts.state, saveOperations)
        : undefined,
    [structured, model, insert.trackChanges, drafts.state, saveOperations],
  )
  const blocks = useMemo(() => {
    const story = structured ? documentStory(structured) : undefined
    return story ? storyBlocks(story) : []
  }, [structured])
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
            flow,
            pendingRedlines,
          )
        : [],
    [
      broken,
      blocks,
      drafts.drafts,
      drafts.inserts,
      drafts.extraRuns,
      drafts.breaks,
      flow,
      pendingRedlines,
    ],
  )
  const printBox = useMemo<PageBox | undefined>(
    () =>
      broken
        ? pageBoxForSection(documentSections(broken)[0]?.xml ?? '')
        : undefined,
    [broken],
  )
  const imageParts = useMemo(
    () => (model ? documentImagePartNames(model) : []),
    [model],
  )
  const fetchedImageUrls = useDocumentImageUrls(documentId, imageParts)
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
  const toaFacts = useMemo<TableOfAuthoritiesFacts>(() => {
    if (!model) {
      return {
        occurrences: [],
        entries: [],
        citingWires: [],
        fields: new Map(),
      }
    }
    return createTableOfAuthoritiesFacts({
      model,
      batchDeletions: deletions.effective,
      drafts: drafts.drafts,
      extraRuns: drafts.extraRuns,
      paragraphStyles: drafts.format.paragraphStyles,
    })()
  }, [
    model,
    deletions,
    drafts.drafts,
    drafts.extraRuns,
    drafts.format.paragraphStyles,
  ])
  const linkOverlays = useMemo(
    () => structuralLinkOverlays(painted, drafts.structures),
    [painted, drafts.structures],
  )
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
    pendingRedlines,
    pages,
    printBox,
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
