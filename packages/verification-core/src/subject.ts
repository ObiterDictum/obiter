import { z } from 'zod'

/**
 * Opaque reference to the immutable draft version under verification. These
 * are the only draft identifiers the domain layer holds: a document and a
 * version id, never a title, matter name or paragraph text.
 */
export const verificationSubjectSchema = z
  .object({
    documentId: z.string().trim().min(1),
    versionId: z.string().trim().min(1),
  })
  .strict()
export type VerificationSubject = z.infer<typeof verificationSubjectSchema>

/**
 * A span inside the subject draft, by paragraph id and character offsets.
 * A location is a reference, not content: a finding can be stored, logged and
 * rendered without carrying any of the matter it points at. `end` is
 * exclusive.
 */
export const draftLocationSchema = z
  .object({
    paragraphId: z.string().trim().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((location) => location.end > location.start, {
    message: 'Draft location end must be greater than start.',
    path: ['end'],
  })
export type DraftLocation = z.infer<typeof draftLocationSchema>
