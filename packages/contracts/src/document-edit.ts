import { z } from 'zod'

import { isValidXmlText } from './xml-text'

export const DOCUMENT_EDIT_ID_MAX_LENGTH = 255
export const DOCUMENT_EDIT_TEXT_MAX_LENGTH = 1_000_000
export const DOCUMENT_EDIT_OPERATION_MAX_COUNT = 100
export const DOCUMENT_EDIT_RUN_MAX_COUNT = 4_096
export const DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH = 64
export const DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN = 2
export const DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX = 1_638
export const DOCUMENT_EDIT_TWIP_MIN = 0
export const DOCUMENT_EDIT_TWIP_MAX = 31_680
export const DOCUMENT_EDIT_COLOUR_PATTERN = /^(auto|[0-9A-Fa-f]{6})$/

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

export const editIdSchema = z
  .string()
  .min(1)
  .max(DOCUMENT_EDIT_ID_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, {
    message: 'Document edit identifiers must not be blank.',
  })

const editTextSchema = z
  .string()
  .max(DOCUMENT_EDIT_TEXT_MAX_LENGTH)
  .refine(isValidXmlText, {
    message: 'Document edit text contains an unsupported XML character.',
  })

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
const twipSchema = z
  .number()
  .int()
  .min(DOCUMENT_EDIT_TWIP_MIN)
  .max(DOCUMENT_EDIT_TWIP_MAX)
const characterOffsetSchema = z
  .number()
  .int()
  .min(0)
  .max(DOCUMENT_EDIT_TEXT_MAX_LENGTH)

const runPropertyFields = {
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

const editRunSchema = z
  .object({
    text: editTextSchema,
    styleId: styleIdSchema.optional(),
    ...runPropertyFields,
  })
  .strict()
export type DocumentEditRun = z.infer<typeof editRunSchema>

const indentationSchema = z
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

const lineSpacingSchema = z
  .object({
    line: twipSchema,
    lineRule: documentEditLineRuleSchema.optional(),
  })
  .strict()

const paragraphFormatFields = {
  alignment: documentEditAlignmentSchema.nullable().optional(),
  lineSpacing: lineSpacingSchema.nullable().optional(),
  spaceBefore: twipSchema.nullable().optional(),
  spaceAfter: twipSchema.nullable().optional(),
  indentation: indentationSchema.nullable().optional(),
}

const RUN_PROPERTY_KEYS = [
  'bold',
  'italic',
  'underline',
  'fontFamily',
  'fontSize',
  'colour',
  'highlight',
  'strikethrough',
  'vertAlign',
  'smallCaps',
] as const

const PARAGRAPH_FORMAT_KEYS = [
  'alignment',
  'lineSpacing',
  'spaceBefore',
  'spaceAfter',
  'indentation',
] as const

function requireAssigned(
  value: Record<string, unknown>,
  keys: readonly string[],
  context: z.RefinementCtx,
  message: string,
) {
  if (keys.some((key) => value[key] !== undefined)) return
  context.addIssue({ code: 'custom', path: [keys[0] ?? ''], message })
}

export const documentEditOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('replace_run_text'),
      runId: editIdSchema,
      text: editTextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('set_run_style'),
      runId: editIdSchema,
      styleId: styleIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('set_paragraph_style'),
      paragraphId: editIdSchema,
      styleId: styleIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('set_run_emphasis'),
      runId: editIdSchema.optional(),
      paragraphId: editIdSchema.optional(),
      from: characterOffsetSchema.optional(),
      to: characterOffsetSchema.optional(),
      ...runPropertyFields,
    })
    .strict()
    .superRefine((operation, context) => {
      requireAssigned(
        operation,
        RUN_PROPERTY_KEYS,
        context,
        'At least one run property must be assigned.',
      )
      const hasRun = operation.runId !== undefined
      const rangeParts = [
        operation.paragraphId !== undefined,
        operation.from !== undefined,
        operation.to !== undefined,
      ]
      const rangeCount = rangeParts.filter(Boolean).length
      const hasRange = rangeCount === 3
      if (hasRun === hasRange || (rangeCount > 0 && !hasRange)) {
        context.addIssue({
          code: 'custom',
          path: hasRun ? ['paragraphId'] : ['runId'],
          message:
            'set_run_emphasis requires runId or paragraphId with from and to, not both.',
        })
        return
      }
      if (
        hasRange &&
        operation.from !== undefined &&
        operation.to !== undefined &&
        operation.from >= operation.to
      ) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'from and to must form a non-empty forward range.',
        })
      }
    }),
  z
    .object({
      type: z.literal('set_paragraph_numbering'),
      paragraphId: editIdSchema,
      numId: editIdSchema.nullable(),
      ilvl: z.number().int().min(0).max(8).optional(),
    })
    .strict()
    .superRefine((operation, context) => {
      if (operation.numId !== null && operation.ilvl === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['ilvl'],
          message: 'ilvl is required when numId is set.',
        })
      }
    }),
  z
    .object({
      type: z.literal('set_paragraph_format'),
      paragraphId: editIdSchema,
      ...paragraphFormatFields,
    })
    .strict()
    .superRefine((operation, context) => {
      requireAssigned(
        operation,
        PARAGRAPH_FORMAT_KEYS,
        context,
        'At least one paragraph format property must be assigned.',
      )
    }),
  z
    .object({
      type: z.literal('insert_paragraph_after'),
      paragraphId: editIdSchema,
      text: editTextSchema.optional(),
      runs: z
        .array(editRunSchema)
        .min(1)
        .max(DOCUMENT_EDIT_RUN_MAX_COUNT)
        .optional(),
      styleId: styleIdSchema.optional(),
      ...paragraphFormatFields,
    })
    .strict()
    .superRefine((operation, context) => {
      const hasText = operation.text !== undefined
      const hasRuns = operation.runs !== undefined
      if (hasText === hasRuns) {
        context.addIssue({
          code: 'custom',
          path: hasText ? ['runs'] : ['text'],
          message: 'insert_paragraph_after requires text or runs, not both.',
        })
        return
      }
      if (!operation.runs) return
      const total = operation.runs.reduce(
        (sum, run) => sum + run.text.length,
        0,
      )
      if (total > DOCUMENT_EDIT_TEXT_MAX_LENGTH) {
        context.addIssue({
          code: 'custom',
          path: ['runs'],
          message: 'Inserted run text exceeds the document edit text limit.',
        })
      }
    }),
  z
    .object({
      type: z.literal('delete_paragraph'),
      paragraphId: editIdSchema,
    })
    .strict(),
])
export type DocumentEditOperation = z.infer<typeof documentEditOperationSchema>

export function insertParagraphRuns(
  operation: Extract<DocumentEditOperation, { type: 'insert_paragraph_after' }>,
): DocumentEditRun[] {
  return operation.runs ?? [{ text: operation.text ?? '' }]
}

export const documentEditOperationsSchema = z
  .array(documentEditOperationSchema)
  .min(1)
  .max(DOCUMENT_EDIT_OPERATION_MAX_COUNT)

export const documentEditRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    operations: documentEditOperationsSchema,
    trackChanges: z.boolean().optional().default(false),
  })
  .strict()
export type DocumentEditRequest = z.infer<typeof documentEditRequestSchema>

export const documentEditResponseSchema = z
  .object({
    documentId: editIdSchema,
    versionId: editIdSchema,
    versionNumber: z.number().int().positive(),
  })
  .strict()
export type DocumentEditResponse = z.infer<typeof documentEditResponseSchema>
