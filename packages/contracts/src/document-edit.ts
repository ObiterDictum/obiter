import { z } from 'zod'

import {
  characterOffsetSchema,
  DOCUMENT_EDIT_TEXT_MAX_LENGTH,
  editIdSchema,
  editTextSchema,
} from './document-edit-shared'
import {
  DOCUMENT_EDIT_NUMBERING_START_MAX,
  DOCUMENT_EDIT_RUN_MAX_COUNT,
  editRunSchema,
  type DocumentEditRun,
  paragraphFormatFields,
  paragraphNumberingSchema,
  runPropertyFields,
  styleIdSchema,
  twipSchema,
} from './document-edit-format'
import {
  deleteFootnoteOperationSchema,
  insertCrossReferenceOperationSchema,
  insertFootnoteOperationSchema,
  insertImageOperationSchema,
  insertPageNumberOperationSchema,
  insertTableOfAuthoritiesOperationSchema,
  insertTableOfContentsOperationSchema,
  updateTableOfAuthoritiesOperationSchema,
  insertTableOperationSchema,
  insertTableRowOperationSchema,
  insertTableColumnOperationSchema,
  deleteTableRowOperationSchema,
  deleteTableColumnOperationSchema,
  deleteTableOperationSchema,
  markDefinedTermOperationSchema,
  setHyperlinkOperationSchema,
  setImageSizeOperationSchema,
} from './document-edit-structural'

export {
  DOCUMENT_EDIT_ID_MAX_LENGTH,
  DOCUMENT_EDIT_TEXT_MAX_LENGTH,
  editIdSchema,
  normaliseEditText,
} from './document-edit-shared'

export const DOCUMENT_EDIT_OPERATION_MAX_COUNT = 100
export {
  DOCUMENT_EDIT_COLOUR_PATTERN,
  DOCUMENT_EDIT_RUN_MAX_COUNT,
  DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_NUMBERING_START_MAX,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MIN,
  DOCUMENT_EDIT_TWIP_MAX,
  DOCUMENT_EDIT_TWIP_MIN,
  documentEditAlignmentSchema,
  documentEditHighlightSchema,
  documentEditLineRuleSchema,
  documentEditVertAlignSchema,
  editRunSchema,
  indentationSchema,
  lineSpacingSchema,
  paragraphFormatFields,
  paragraphNumberingSchema,
  runPropertyFields,
  styleIdSchema,
  twipSchema,
} from './document-edit-format'
export type { DocumentEditRun } from './document-edit-format'

export const documentEditOrientationSchema = z.enum(['portrait', 'landscape'])

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
      intentId: editIdSchema.optional(),
      text: editTextSchema.optional(),
      runs: z
        .array(editRunSchema)
        .min(1)
        .max(DOCUMENT_EDIT_RUN_MAX_COUNT)
        .optional(),
      styleId: styleIdSchema.optional(),
      numbering: paragraphNumberingSchema.optional(),
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
      paragraphId: editIdSchema,
      intentId: editIdSchema.optional(),
      text: editTextSchema.optional(),
      runs: z
        .array(editRunSchema)
        .min(1)
        .max(DOCUMENT_EDIT_RUN_MAX_COUNT)
        .optional(),
      styleId: styleIdSchema.optional(),
      numbering: paragraphNumberingSchema.optional(),
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
  insertTableRowOperationSchema,
  insertTableColumnOperationSchema,
  deleteTableRowOperationSchema,
  deleteTableColumnOperationSchema,
  deleteTableOperationSchema,

  insertImageOperationSchema,
  setImageSizeOperationSchema,
  setHyperlinkOperationSchema,
  insertCrossReferenceOperationSchema,
  insertPageNumberOperationSchema,
  insertFootnoteOperationSchema,
  deleteFootnoteOperationSchema,
  insertTableOfContentsOperationSchema,
  insertTableOfAuthoritiesOperationSchema,
  updateTableOfAuthoritiesOperationSchema,
  markDefinedTermOperationSchema,
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
