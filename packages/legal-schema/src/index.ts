import { z } from 'zod'

export const atlasSourceTypeSchema = z.enum(['judgment', 'legislation'])
export type AtlasSourceType = z.infer<typeof atlasSourceTypeSchema>

export const atlasParagraphSchema = z.object({
  id: z.string().trim().min(1),
  documentId: z.string().trim().min(1),
  paragraphNumber: z.number().int().positive(),
  text: z.string().trim().min(1),
})
export type AtlasParagraph = z.infer<typeof atlasParagraphSchema>

export const atlasAuthoritySchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  neutralCitation: z.string().trim().min(1),
  court: z.string().trim().min(1),
  jurisdiction: z.string().trim().min(1),
  dateDecided: z.string().date(),
  sourceType: atlasSourceTypeSchema,
  sourceUrl: z.string().url(),
  paragraphs: z.array(atlasParagraphSchema).optional(),
})
export type AtlasAuthority = z.infer<typeof atlasAuthoritySchema>

export const atlasAuthoritiesSchema = z.array(atlasAuthoritySchema)
