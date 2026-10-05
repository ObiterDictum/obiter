import { z } from 'zod'
import {
  DOCUMENT_EDIT_TWIP_MAX,
  DOCUMENT_EDIT_TWIP_MIN,
} from '@obiter/contracts'

const twip = z
  .number()
  .int()
  .min(DOCUMENT_EDIT_TWIP_MIN)
  .max(DOCUMENT_EDIT_TWIP_MAX)

/**
 * The persisted shape of one pending paragraph-layout draft. It must admit
 * every `ParagraphFormatDraft` field, because `writeDocumentDraft` serialises
 * the in-memory entries verbatim and `scanPayloads` deletes a payload it cannot
 * parse, which would destroy the whole unsaved draft. Bounds come from the edit
 * contract so persistence and save cannot disagree. Lives beside the draft
 * store rather than inside it to keep that file under the source ceiling.
 */
export const paragraphFormatDraftSchema = z
  .object({
    alignment: z
      .enum(['left', 'center', 'right', 'both'])
      .nullable()
      .optional(),
    lineSpacing: z
      .object({
        line: twip,
        lineRule: z.enum(['auto', 'exact', 'atLeast']).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    indentation: z
      .object({
        left: twip.nullable().optional(),
        right: twip.nullable().optional(),
        firstLine: twip.nullable().optional(),
        hanging: twip.nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
