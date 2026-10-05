import { z } from 'zod'
import {
  DOCUMENT_EDIT_COLOUR_PATTERN,
  DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN,
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
} from '@obiter/contracts'

/**
 * The persisted shape of one pending character-formatting draft. It must admit
 * every `EmphasisPatch` property, because `writeDocumentDraft` serialises the
 * in-memory entries verbatim and `scanPayloads` deletes a payload it cannot
 * parse, which would destroy the whole unsaved draft. Bounds come from the edit
 * contract so persistence and save cannot disagree. Lives beside the draft
 * store rather than inside it to keep that file under the source ceiling.
 */
export const pendingEmphasisSchema = z
  .object({
    runId: z.string().min(1).optional(),
    paragraphId: z.string().min(1).optional(),
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    underline: z.boolean().nullable().optional(),
    strikethrough: z.boolean().nullable().optional(),
    fontFamily: z
      .string()
      .min(1)
      .max(DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH)
      .nullable()
      .optional(),
    fontSize: z
      .number()
      .int()
      .min(DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN)
      .max(DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX)
      .nullable()
      .optional(),
    colour: z
      .string()
      .regex(DOCUMENT_EDIT_COLOUR_PATTERN)
      .nullable()
      .optional(),
    highlight: documentEditHighlightSchema.nullable().optional(),
    vertAlign: documentEditVertAlignSchema.nullable().optional(),
    smallCaps: z.boolean().nullable().optional(),
  })
  .strict()
