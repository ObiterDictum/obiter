import { z } from 'zod'

export const documentStoryKindSchema = z.enum([
  'document',
  'header',
  'footer',
  'footnotes',
  'endnotes',
  'comments',
])
export type DocumentStoryKind = z.infer<typeof documentStoryKindSchema>

export const documentTextRunWireSchema = z.object({
  id: z.string().min(1),
  sourceTextId: z.string().min(1).optional(),
  styleId: z.string().min(1).optional(),
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

export const documentStoryWireSchema = z.object({
  partName: z.string().min(1),
  kind: documentStoryKindSchema,
  paragraphs: z.array(documentParagraphWireSchema),
  preservedXmlFragments: z.array(z.string()),
})
export type DocumentStoryWire = z.infer<typeof documentStoryWireSchema>

export const documentStyleWireSchema = z.object({
  styleId: z.string().min(1),
  basedOnStyleId: z.string().min(1).optional(),
  linkedStyleId: z.string().min(1).optional(),
  sourceFragment: z.string().min(1),
})
export type DocumentStyleWire = z.infer<typeof documentStyleWireSchema>

export const documentNumberingWireSchema = z.object({
  numberingId: z.string().min(1),
  abstractNumberingId: z.string().min(1).optional(),
  startOverride: z.number().int().optional(),
  sourceFragment: z.string().min(1),
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
})
export type DocumentModelWire = z.infer<typeof documentModelWireSchema>

export const documentModelResponseSchema = z.object({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  model: documentModelWireSchema,
})
export type DocumentModelResponse = z.infer<typeof documentModelResponseSchema>
