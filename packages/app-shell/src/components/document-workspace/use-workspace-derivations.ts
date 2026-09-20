import { useMemo } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  extractAuthorities,
  type AuthorityHit,
} from '../../document-authorities'
import { formattedModel } from '../../document-format-edits'
import { documentStory } from '../../document-model-text'
import { layoutDocument, type LaidOutPage } from '../../document-page-engine'
import { storyBlocks } from '../../document-page-tables'
import { documentImagePartNames } from '../../document-page-media'
import { useDocumentImageUrls } from '../../document-workspace-api'
import type { useWorkspaceDrafts } from './use-workspace-drafts'

type DraftState = Pick<
  ReturnType<typeof useWorkspaceDrafts>,
  'drafts' | 'inserts' | 'extraRuns' | 'format' | 'deletedParagraphIds'
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
export function useWorkspaceDerivations({
  documentId,
  model,
  drafts,
}: {
  documentId: string
  model: DocumentModelWire | undefined
  drafts: DraftState
}): {
  painted: DocumentModelWire | undefined
  pages: LaidOutPage[]
  authorities: AuthorityHit[]
  imageUrls: Record<string, string>
} {
  const painted = useMemo(
    () => (model ? formattedModel(model, drafts.format) : undefined),
    [model, drafts.format],
  )
  // The story's block partition is a pure function of the painted model, so it
  // is scanned once per model rather than once per pagination pass.
  const blocks = useMemo(() => {
    const story = painted ? documentStory(painted) : undefined
    return story ? storyBlocks(story) : []
  }, [painted])
  const pages = useMemo(
    () =>
      painted
        ? layoutDocument(
            painted,
            drafts.drafts,
            drafts.inserts,
            drafts.extraRuns,
            blocks,
          )
        : [],
    [painted, blocks, drafts.drafts, drafts.inserts, drafts.extraRuns],
  )
  const imageParts = useMemo(
    () => (model ? documentImagePartNames(model) : []),
    [model],
  )
  const imageUrls = useDocumentImageUrls(documentId, imageParts)
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
  return { painted, pages, authorities, imageUrls }
}
