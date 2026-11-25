import { z } from 'zod'

export const legislationStatusSchema = z.enum([
  'current',
  'amended_not_held',
  'repealed',
])
export type LegislationStatus = z.infer<typeof legislationStatusSchema>

export const legislationActTextPageSize = 50
export const legislationSubsectionSchema = z.object({
  label: z.string(),
  labelPath: z.string(),
  versionNote: z.string().optional(),
  href: z.string(),
  legislationStatus: legislationStatusSchema,
  repealedFrom: z.string().optional(),
  text: z.string().optional(),
  get children() {
    return z.array(legislationSubsectionSchema)
  },
})
export type LegislationProvisionSubsection = z.infer<
  typeof legislationSubsectionSchema
>

const provisionLinks = z.object({
  officialUrl: z.string(),
  canonicalUrl: z.string(),
})

export const legislationProvisionWordingSchema = z.discriminatedUnion(
  'legislationStatus',
  [
    provisionLinks.extend({
      legislationStatus: z.literal('current'),
      text: z.string(),
      subsections: z.array(legislationSubsectionSchema).optional(),
    }),
    provisionLinks.extend({
      legislationStatus: z.literal('amended_not_held'),
      notice: z.string(),
    }),
    provisionLinks.extend({
      legislationStatus: z.literal('repealed'),
      repealedFrom: z.string().optional(),
      notice: z.string(),
    }),
  ],
)
export type LegislationProvisionWording = z.infer<
  typeof legislationProvisionWordingSchema
>

export const legislationActTextPageSchema = z.object({
  entries: z
    .array(
      z.object({
        labelPath: z.string(),
        provision: legislationProvisionWordingSchema.optional(),
      }),
    )
    .max(50),
  nextOffset: z.int().nonnegative().nullable(),
})
export type LegislationActTextPage = z.infer<
  typeof legislationActTextPageSchema
>
