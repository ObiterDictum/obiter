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
  text: z.string(),
  preservedXmlFragments: z.array(z.string()),
})
export type DocumentTextRunWire = z.infer<typeof documentTextRunWireSchema>

export const documentParagraphWireSchema = z.object({
  id: z.string().min(1),
  sourceParaId: z.string().min(1).optional(),
  sourceTextId: z.string().min(1).optional(),
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

export const documentModelWireSchema = z.object({
  version: z.literal(1),
  stories: z.array(documentStoryWireSchema),
  styles: z.array(documentStyleWireSchema),
  numbering: z.array(documentNumberingWireSchema),
  relationships: z.array(documentRelationshipWireSchema),
  preservedXmlFragments: z.array(preservedDocumentXmlFragmentSchema),
})
export type DocumentModelWire = z.infer<typeof documentModelWireSchema>
