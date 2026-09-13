import { z } from 'zod'

/**
 * Opaque reference to the immutable draft version under verification. These
 * are the only draft identifiers the domain layer holds: a document and a
 * version id, never a title, matter name or paragraph text. A location is only
 * meaningful against the version it was taken from, so a re-saved document is a
 * different subject even when the document id is unchanged.
 */
export const verificationSubjectSchema = z
  .object({
    documentId: z.string().trim().min(1),
    versionId: z.string().trim().min(1),
  })
  .strict()
export type VerificationSubject = z.infer<typeof verificationSubjectSchema>

/**
 * A span inside one paragraph of the subject version, by paragraph id and
 * character offsets. A location is a reference, not content: a finding can be
 * stored, logged and rendered without carrying any of the matter it points at.
 *
 * - Offsets are JavaScript string indices, so they are measured in UTF-16 code
 *   units (an astral character counts as two), exactly like
 *   `String.prototype.slice`. They are not code points, bytes, or OOXML
 *   positions.
 * - They index the paragraph's plain-text projection: the concatenation
 *   `paragraphPlainText(paragraph, drafts)` from
 *   `packages/app-shell/src/document-model-text.ts` plus any extra runs, or the
 *   inserted plain text for a locally inserted paragraph. That is the
 *   projection `extractAuthorities` in
 *   `packages/app-shell/src/document-authorities.ts` produces offsets against.
 * - The range is half-open: `start` is inclusive, `end` is exclusive, and
 *   `end > start`. Zero-length and reversed spans are rejected.
 * - `paragraphId` names the paragraph. Run, page, and section coordinates are
 *   not part of a location; a paragraph is the resolution this layer needs.
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
