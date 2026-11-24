import { z } from 'zod'

import { isValidXmlText } from './xml-text'
import { editIdSchema, editTextSchema } from './document-edit-shared'

export const DOCUMENT_EDIT_RUN_MAX_COUNT = 4_096
export const DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH = 64
export const DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN = 2
export const DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX = 1_638
export const DOCUMENT_EDIT_TWIP_MIN = 0
export const DOCUMENT_EDIT_TWIP_MAX = 31_680
export const DOCUMENT_EDIT_COLOUR_PATTERN = /^(auto|[0-9A-Fa-f]{6})$/
export const DOCUMENT_EDIT_NUMBERING_START_MAX = 32_767

export const documentEditHighlightSchema = z.enum([
  'yellow',
  'green',
  'cyan',
  'magenta',
  'blue',
  'red',
  'darkBlue',
  'darkCyan',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'darkGray',
  'lightGray',
  'black',
  'none',
])
export const documentEditVertAlignSchema = z.enum([
  'superscript',
  'subscript',
  'baseline',
])
export const documentEditAlignmentSchema = z.enum([
  'left',
  'center',
  'right',
  'both',
])
export const documentEditLineRuleSchema = z.enum(['auto', 'exact', 'atLeast'])

const styleIdSchema = editIdSchema.nullable()
const colourSchema = z
  .string()
  .regex(DOCUMENT_EDIT_COLOUR_PATTERN, {
    message: 'Colour must be auto or six hex digits.',
  })
  .nullable()
const fontFamilySchema = z
  .string()
  .min(1)
  .max(DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH)
  .refine(isValidXmlText, {
    message: 'Font family contains an unsupported XML character.',
  })
  .nullable()
const fontSizeSchema = z
  .number()
  .int()
  .min(DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN)
  .max(DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX)
  .nullable()
export const twipSchema = z
  .number()
  .int()
  .min(DOCUMENT_EDIT_TWIP_MIN)
  .max(DOCUMENT_EDIT_TWIP_MAX)

export const runPropertyFields = {
  bold: z.boolean().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  underline: z.boolean().nullable().optional(),
  fontFamily: fontFamilySchema.optional(),
  fontSize: fontSizeSchema.optional(),
  colour: colourSchema.optional(),
  highlight: documentEditHighlightSchema.nullable().optional(),
  strikethrough: z.boolean().nullable().optional(),
  vertAlign: documentEditVertAlignSchema.nullable().optional(),
  smallCaps: z.boolean().nullable().optional(),
}

export const editRunSchema = z
  .object({
    text: editTextSchema,
    styleId: styleIdSchema.optional(),
    ...runPropertyFields,
  })
  .strict()
export type DocumentEditRun = z.infer<typeof editRunSchema>

export const indentationSchema = z
  .object({
    left: twipSchema.nullable().optional(),
    right: twipSchema.nullable().optional(),
    firstLine: twipSchema.nullable().optional(),
    hanging: twipSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.firstLine != null && value.hanging != null) {
      context.addIssue({
        code: 'custom',
        path: ['hanging'],
        message: 'firstLine and hanging cannot both be set.',
      })
    }
  })

export const lineSpacingSchema = z
  .object({
    line: twipSchema,
    lineRule: documentEditLineRuleSchema.optional(),
  })
  .strict()

export const paragraphNumberingSchema = z
  .object({
    numId: editIdSchema,
    ilvl: z.number().int().min(0).max(8),
    startOverride: z
      .number()
      .int()
      .min(1)
      .max(DOCUMENT_EDIT_NUMBERING_START_MAX)
      .nullable()
      .optional(),
  })
  .strict()

export const paragraphFormatFields = {
  alignment: documentEditAlignmentSchema.nullable().optional(),
  lineSpacing: lineSpacingSchema.nullable().optional(),
  spaceBefore: twipSchema.nullable().optional(),
  spaceAfter: twipSchema.nullable().optional(),
  indentation: indentationSchema.nullable().optional(),
}

export { styleIdSchema, editTextSchema }
