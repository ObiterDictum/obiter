import { z } from 'zod'
import {
  DOCUMENT_EDIT_COLOUR_PATTERN,
  DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN,
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
  isValidXmlText,
} from '@obiter/contracts'

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
      .refine(isValidXmlText, {
        message: 'Font family contains an unsupported XML character.',
      })
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
