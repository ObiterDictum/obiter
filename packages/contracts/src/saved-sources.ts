import { z } from 'zod'

export const savedSourceKindSchema = z.enum(['judgment', 'legislation'])
export type SavedSourceKind = z.infer<typeof savedSourceKindSchema>

export const savedMatterSourceSchema = z.object({
  id: z.string().min(1),
  matterId: z.string().min(1),
  kind: savedSourceKindSchema,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  citation: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
})
export type SavedMatterSource = z.infer<typeof savedMatterSourceSchema>

export const savedMatterSourceCreateRequestSchema = z
  .object({
    kind: savedSourceKindSchema,
    sourceId: z.string().min(1).max(512),
    title: z.string().min(1).max(512),
    citation: z.string().min(1).max(512).nullable().optional(),
    sourceUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict()
export type SavedMatterSourceCreateRequest = z.infer<
  typeof savedMatterSourceCreateRequestSchema
>

export const savedMatterSourceCreateResponseSchema = z.object({
  savedSource: savedMatterSourceSchema,
})
export type SavedMatterSourceCreateResponse = z.infer<
  typeof savedMatterSourceCreateResponseSchema
>

export const savedMatterSourceListResponseSchema = z.object({
  savedSources: z.array(savedMatterSourceSchema),
})
export type SavedMatterSourceListResponse = z.infer<
  typeof savedMatterSourceListResponseSchema
>
