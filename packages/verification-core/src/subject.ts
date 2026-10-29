import { z } from 'zod'

export const verificationSubjectSchema = z
  .object({
    documentId: z.string().trim().min(1),
    versionId: z.string().trim().min(1),
  })
  .strict()
export type VerificationSubject = z.infer<typeof verificationSubjectSchema>

export const draftLocationSchema = z
  .object({
    paragraphId: z.string().trim().min(1),
    storyKind: z.string().trim().min(1).optional(),
    storyPartName: z.string().trim().min(1).optional(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((location) => location.end > location.start, {
    message: 'Draft location end must be greater than start.',
    path: ['end'],
  })
export type DraftLocation = z.infer<typeof draftLocationSchema>
