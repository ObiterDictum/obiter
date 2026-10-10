import { z } from 'zod'

import { documentImportedCommentSchema } from './document-comments'
import { documentMarkingsStateSchema } from './document-markings'

export const documentStoryKindSchema = z.enum([
  'document',
  'header',
  'footer',
  'footnotes',
  'endnotes',
  'comments',
])
export type DocumentStoryKind = z.infer<typeof documentStoryKindSchema>

/**
 * The story kinds the edit surface can write to: the body, the
 * header/footer margin stories, and the footnotes story. Endnote and
 * comment stories stay read-only. The OOXML writer gates operations on this
 * set and the workspace's editable-model helpers share it — contract-level
 * because the workspace draft path must not reach the writer package (the
 * same constraint that keeps `imageExtensionForContentType` in this
 * package).
 */
export const EDITABLE_STORY_KINDS: ReadonlySet<DocumentStoryKind> = new Set([
  'document',
  'header',
  'footer',
  'footnotes',
])

/**
 * The stories a `PAGE` field resolves in: the body and the margins a page
 * number paints over. A note story has no page of its own, so a field
 * anchored there could never resolve.
 */
export const PAGE_STORY_KINDS: ReadonlySet<DocumentStoryKind> = new Set([
  'document',
  'header',
  'footer',
])

export const documentTextRunWireSchema = z.object({
  id: z.string().min(1),
  sourceTextId: z.string().min(1).optional(),
  styleId: z.string().min(1).optional(),
  /**
   * The external target of the `w:hyperlink` wrapping this run, resolved
   * through the part's relationships at parse. Whole runs only: a hyperlink
   * boundary that falls inside a run is represented by that run splitting,
   * so every piece keeps the field.
   */
  hyperlinkTarget: z.string().min(1).optional(),
  text: z.string(),
  preservedXmlFragments: z.array(z.string()),
})
export type DocumentTextRunWire = z.infer<typeof documentTextRunWireSchema>

export const documentParagraphWireSchema = z.object({
  id: z.string().min(1),
  sourceParaId: z.string().min(1).optional(),
  sourceTextId: z.string().min(1).optional(),
  styleId: z.string().min(1).optional(),
  runs: z.array(documentTextRunWireSchema),
  preservedXmlFragments: z.array(z.string()),
})
export type DocumentParagraphWire = z.infer<typeof documentParagraphWireSchema>

/**
 * One stored field the parser paired from the story's source markup: a
 * complex `w:fldChar` field or a self-contained `w:fldSimple`. The wire's
 * paragraph and run fragments lose element parentage and sibling order —
 * whether a field's `end` run leads its paragraph, or a `w:tbl` sits inside
 * the field's range — so the parser records the pairings and the shape facts
 * consumers need here, where they are still computable.
 */
export const documentFieldWireSchema = z.object({
  /** The paragraph holding the field's `begin` — the anchor an update
   * operation names — or the paragraph a `w:fldSimple` sits in. */
  headId: z.string().min(1),
  /** The paragraph holding the field's `end`; absent when the field never
   * closes in this part or its `end` lands in unmodelled markup. */
  tailId: z.string().min(1).optional(),
  /** The field's `end` arrived inside this part. */
  closed: z.boolean(),
  /**
   * The paragraphs holding the field's boundary markers — its `begin`,
   * `separate` and `end` characters, or the `w:fldSimple` element itself.
   * A deletion removing some but not all leaves the stored field
   * unbalanced, so any removal touching them must cover them all.
   */
  boundaryIds: z.array(z.string().min(1)).min(1),
  /** Every paragraph the field's range covers, head through tail. */
  paragraphIds: z.array(z.string().min(1)).min(1),
  /** The paragraphs carrying the field's stored result — `paragraphIds`
   * minus the tail — the span an in-place refresh rewrites. */
  resultIds: z.array(z.string().min(1)),
  /** The decoded field instruction — ` TOA \h \c "1" `, ` REF _Ref1 ` —
   * for the consumers classifying the field. */
  instruction: z.string(),
  /**
   * True only when the stored shape proves the range rewrite an in-place
   * refresh performs: the field closes, its `begin` is the head
   * paragraph's first field character, a `separate` sits in that
   * paragraph, the `end` leads a different tail paragraph inside a
   * direct-child run holding nothing else, and no non-paragraph sibling
   * interrupts the range.
   */
  rangeReplaceable: z.boolean(),
  /**
   * Every boundary marker sits inside a paragraph the model carries.
   * `false` means `boundaryIds` cannot enumerate every carrier — a marker
   * hides inside tracked or otherwise unmodelled markup — so no deletion
   * touching the listed paragraphs can prove the field stays balanced.
   */
  boundariesAnchored: z.boolean(),
})
export type DocumentFieldWire = z.infer<typeof documentFieldWireSchema>

export const documentStoryWireSchema = z.object({
  partName: z.string().min(1),
  kind: documentStoryKindSchema,
  paragraphs: z.array(documentParagraphWireSchema),
  preservedXmlFragments: z.array(z.string()),
  /**
   * The stored fields the parser paired in this story, in document order.
   * Required so a cached model written before the wire carried field
   * metadata fails validation and regenerates rather than claiming no
   * fields exist.
   */
  fields: z.array(documentFieldWireSchema),
  /**
   * Paragraphs carrying a boundary marker of a field whose `begin` — or
   * another marker — sits inside markup the model does not carry, so the
   * field's full carrier set cannot be enumerated. A deletion touching one
   * of them is never provably balanced, so it is refused outright.
   */
  unanchoredFieldParagraphIds: z.array(z.string().min(1)),
})
export type DocumentStoryWire = z.infer<typeof documentStoryWireSchema>

export const documentStyleWireSchema = z.object({
  styleId: z.string().min(1),
  basedOnStyleId: z.string().min(1).optional(),
  linkedStyleId: z.string().min(1).optional(),
  sourceFragment: z.string().min(1),
})
export type DocumentStyleWire = z.infer<typeof documentStyleWireSchema>

export const documentNumberingLevelWireSchema = z.object({
  ilvl: z.number().int().nonnegative().max(8),
  start: z.number().int().positive().optional(),
  numFmt: z.string().min(1).max(64),
  lvlText: z.string().max(64).optional(),
  indentLeftTwips: z.number().int().optional(),
  hangingTwips: z.number().int().optional(),
})
export type DocumentNumberingLevelWire = z.infer<
  typeof documentNumberingLevelWireSchema
>

export const documentNumberingWireSchema = z.object({
  numberingId: z.string().min(1),
  abstractNumberingId: z.string().min(1).optional(),
  startOverride: z.number().int().optional(),
  sourceFragment: z.string().min(1),
  levels: z.array(documentNumberingLevelWireSchema).optional(),
})
export type DocumentNumberingWire = z.infer<typeof documentNumberingWireSchema>

export const documentRelationshipWireSchema = z.object({
  sourcePartName: z.string(),
  id: z.string().min(1),
  type: z.string().min(1),
  target: z.string().min(1),
  targetMode: z.string().min(1).optional(),
  sourceFragment: z.string().min(1),
})
export type DocumentRelationshipWire = z.infer<
  typeof documentRelationshipWireSchema
>

export const preservedDocumentXmlFragmentSchema = z.object({
  partName: z.string().min(1),
  xml: z.string(),
})
export type PreservedDocumentXmlFragment = z.infer<
  typeof preservedDocumentXmlFragmentSchema
>

const documentChangeWireBaseSchema = z.object({
  id: z.string().min(1),
  ooxmlId: z.string().optional(),
  pairId: z.string().min(1).optional(),
  author: z.string().optional(),
  date: z.string().optional(),
  storyPartName: z.string().min(1),
  paragraphId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  text: z.string(),
  /**
   * Why the decision engine can never decide this listed change, when it
   * cannot: an unsupported move shape (`unsupported-move`) or a property
   * change that did not record the properties it replaced
   * (`missing-property-snapshot`). Undecidable changes stay listed and
   * byte-preserved; the reason lets a review surface refuse honestly instead
   * of offering a decision the engine would reject.
   */
  undecidable: z
    .enum(['unsupported-move', 'missing-property-snapshot'])
    .optional(),
})

export const documentChangeWireSchema = z.discriminatedUnion('elementName', [
  documentChangeWireBaseSchema
    .extend({ kind: z.literal('insert'), elementName: z.literal('ins') })
    .strict(),
  documentChangeWireBaseSchema
    .extend({ kind: z.literal('delete'), elementName: z.literal('del') })
    .strict(),
  documentChangeWireBaseSchema
    .extend({
      kind: z.literal('move'),
      elementName: z.literal('moveFrom'),
      direction: z.literal('from'),
    })
    .strict(),
  documentChangeWireBaseSchema
    .extend({
      kind: z.literal('move'),
      elementName: z.literal('moveTo'),
      direction: z.literal('to'),
    })
    .strict(),
  documentChangeWireBaseSchema
    .extend({
      kind: z.literal('property'),
      elementName: z.literal('rPrChange'),
      scope: z.literal('run'),
    })
    .strict(),
  documentChangeWireBaseSchema
    .extend({
      kind: z.literal('property'),
      elementName: z.literal('pPrChange'),
      scope: z.literal('paragraph'),
    })
    .strict(),
])
export type DocumentChangeWire = z.infer<typeof documentChangeWireSchema>

export const documentModelWireSchema = z.object({
  version: z.literal(1),
  stories: z.array(documentStoryWireSchema),
  styles: z.array(documentStyleWireSchema),
  numbering: z.array(documentNumberingWireSchema),
  relationships: z.array(documentRelationshipWireSchema),
  preservedXmlFragments: z.array(preservedDocumentXmlFragmentSchema),
  changes: z.array(documentChangeWireSchema).default([]),
  /**
   * Comments carried by the package's own `word/comments.xml`. Required rather
   * than defaulted so a cached model written before this field existed fails
   * validation and regenerates instead of reporting no imported comments.
   */
  comments: z.array(documentImportedCommentSchema),
  /**
   * The package's own `docProps/custom.xml` markings. Required for the same
   * reason as `comments`: a cached model written before the wire carried
   * them fails validation and regenerates rather than reporting none.
   */
  markings: documentMarkingsStateSchema,
})
export type DocumentModelWire = z.infer<typeof documentModelWireSchema>

export const documentModelResponseSchema = z.object({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  model: documentModelWireSchema,
})
export type DocumentModelResponse = z.infer<typeof documentModelResponseSchema>
