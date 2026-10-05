import { z } from 'zod'

import { isValidXmlText } from './xml-text'
import {
  characterOffsetSchema,
  DOCUMENT_EDIT_TEXT_MAX_LENGTH,
  editIdSchema,
} from './document-edit-shared'
import {
  insertImageOperationSchema,
  insertTableOperationSchema,
} from './document-edit-structural'

export {
  DOCUMENT_EDIT_ID_MAX_LENGTH,
  DOCUMENT_EDIT_TEXT_MAX_LENGTH,
  editIdSchema,
} from './document-edit-shared'

export const DOCUMENT_EDIT_OPERATION_MAX_COUNT = 100
export const DOCUMENT_EDIT_RUN_MAX_COUNT = 4_096
export const DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH = 64
export const DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN = 2
export const DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX = 1_638
export const DOCUMENT_EDIT_TWIP_MIN = 0
export const DOCUMENT_EDIT_TWIP_MAX = 31_680
export const DOCUMENT_EDIT_COLOUR_PATTERN = /^(auto|[0-9A-Fa-f]{6})$/
/**
 * The largest list restart value the contract accepts. Word stores a start
 * override as a decimal number, but no real list starts past a signed 16-bit
 * count; the bound keeps a hostile client from writing an unbounded marker.
 */
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
export const documentEditOrientationSchema = z.enum(['portrait', 'landscape'])

const editTextSchema = z
  .string()
  .max(DOCUMENT_EDIT_TEXT_MAX_LENGTH)
  .refine(isValidXmlText, {
    message: 'Document edit text contains an unsupported XML character.',
  })
  .transform(normaliseEditText)

/**
 * One text representation at the boundary. A CRLF pair and a lone CR are the
 * same logical break as LF, so the model never carries a \r that serialised
 * OOXML cannot reproduce. See docs/architecture.md, "Document edit operation
 * batches".
 */
export function normaliseEditText(value: string) {
  return value.replace(/\r\n?/gu, '\n')
}

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

/**
 * Direct page-margin overrides in twips. A field leaves the attribute alone when
 * absent and releases it to its inherited/default value when null. `margins:
 * null` releases the whole `w:pgMar` element.
 */
const sectionMarginsSchema = z
  .object({
    top: twipSchema.nullable().optional(),
    right: twipSchema.nullable().optional(),
    bottom: twipSchema.nullable().optional(),
    left: twipSchema.nullable().optional(),
    header: twipSchema.nullable().optional(),
    footer: twipSchema.nullable().optional(),
    gutter: twipSchema.nullable().optional(),
  })
  .strict()

const sectionPageSizeSchema = z
  .object({
    width: twipSchema,
    height: twipSchema,
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
      /**
       * Restart the list at this number. `null`/absent leaves the numbering
       * instance as-is; a value points the paragraph at an instance that
       * carries `w:lvlOverride`/`w:startOverride` for `ilvl`.
       */
      startOverride: z
        .number()
        .int()
        .min(1)
        .max(DOCUMENT_EDIT_NUMBERING_START_MAX)
        .nullable()
        .optional(),
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
      if (operation.startOverride != null && operation.numId === null) {
        context.addIssue({
          code: 'custom',
          path: ['startOverride'],
          message: 'startOverride requires a numbering instance.',
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
      /**
       * Opaque client correlation id. It is echoed back in the lineage so the
       * client can name the stored paragraph without matching insert order.
       * It is never a persisted document identity and is validated server-side.
       */
      intentId: editIdSchema.optional(),
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
      type: z.literal('insert_paragraph_before'),
      /** The paragraph the restored content is placed before. */
      paragraphId: editIdSchema,
      intentId: editIdSchema.optional(),
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
          message: 'insert_paragraph_before requires text or runs, not both.',
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
  z
    .object({
      type: z.literal('set_section_properties'),
      margins: sectionMarginsSchema.nullable().optional(),
      orientation: documentEditOrientationSchema.nullable().optional(),
      pageSize: sectionPageSizeSchema.nullable().optional(),
    })
    .strict()
    .superRefine((operation, context) => {
      requireAssigned(
        operation,
        ['margins', 'orientation', 'pageSize'],
        context,
        'At least one section property must be assigned.',
      )
      // An explicit size and an orientation cannot contradict: the writer
      // emits `w:orient` alongside the dimensions, and readers disagree on
      // which wins. The dimensions are authoritative, matching the writer's
      // own derivation.
      const size = operation.pageSize
      const orientation = operation.orientation
      if (size && orientation !== undefined && orientation !== null) {
        const derived = size.width > size.height ? 'landscape' : 'portrait'
        if (derived !== orientation) {
          context.addIssue({
            code: 'custom',
            path: ['orientation'],
            message:
              'orientation contradicts the explicit pageSize dimensions.',
          })
        }
      }
    }),
  z
    .object({
      type: z.literal('insert_break'),
      paragraphId: editIdSchema,
      offset: characterOffsetSchema,
      kind: z.literal('page'),
    })
    .strict(),
  z
    .object({
      type: z.literal('insert_section_break'),
      paragraphId: editIdSchema,
    })
    .strict(),
  insertTableOperationSchema,
  insertImageOperationSchema,
])
export type DocumentEditOperation = z.infer<typeof documentEditOperationSchema>

export function insertParagraphRuns(
  operation: Extract<
    DocumentEditOperation,
    { type: 'insert_paragraph_after' | 'insert_paragraph_before' }
  >,
): DocumentEditRun[] {
  return operation.runs ?? [{ text: operation.text ?? '' }]
}

/**
 * Batch semantics - the coordinate space operations address, replacement
 * precedence, overlap resolution and atomic failure - are normative in
 * docs/architecture.md, "Document edit operation batches". The request and
 * response envelopes live in `document-edit-request.ts`.
 */
