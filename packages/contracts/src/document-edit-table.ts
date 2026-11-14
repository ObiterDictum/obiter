import { z } from 'zod'
import { isValidXmlText } from './xml-text'
import {
  DOCUMENT_EDIT_RUN_MAX_COUNT,
  editRunSchema,
  paragraphFormatFields,
  paragraphNumberingSchema,
} from './document-edit-format'
import { editIdSchema } from './document-edit-shared'

const cellParagraphSchema = z
  .object({
    styleId: editIdSchema.optional(),
    numbering: paragraphNumberingSchema.optional(),
    ...paragraphFormatFields,
  })
  .strict()

const tableCellEditSchema = z
  .object({
    row: z.number().int().min(0).max(1000),
    column: z.number().int().min(0).max(1000),
    text: z.string().max(100000).refine(isValidXmlText).optional(),
    runs: z.array(editRunSchema).max(DOCUMENT_EDIT_RUN_MAX_COUNT).optional(),
    paragraph: cellParagraphSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.text === undefined &&
      value.runs === undefined &&
      value.paragraph === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'A table cell edit needs text, runs or paragraph properties.',
      })
    }
  })

export const tableCellEditsSchema = z
  .array(tableCellEditSchema)
  .max(10000)
  .optional()

export type TableCellEdit = z.infer<typeof tableCellEditSchema>

export const insertTableRowOperationSchema = z
  .object({
    type: z.literal('insert_table_row'),
    paragraphId: editIdSchema,
    cellEdits: tableCellEditsSchema,
    rowIndex: z.number().int().min(0).max(1000).optional(),
    columnIndex: z.number().int().min(0).max(1000).optional(),
    position: z.enum(['before', 'after']),
  })
  .strict()
export const insertTableColumnOperationSchema = z
  .object({
    type: z.literal('insert_table_column'),
    paragraphId: editIdSchema,
    cellEdits: tableCellEditsSchema,
    rowIndex: z.number().int().min(0).max(1000).optional(),
    columnIndex: z.number().int().min(0).max(1000).optional(),
    position: z.enum(['before', 'after']),
  })
  .strict()
export const deleteTableRowOperationSchema = z
  .object({
    type: z.literal('delete_table_row'),
    paragraphId: editIdSchema,
    cellEdits: tableCellEditsSchema,
    rowIndex: z.number().int().min(0).max(1000).optional(),
    columnIndex: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
export const deleteTableColumnOperationSchema = z
  .object({
    type: z.literal('delete_table_column'),
    paragraphId: editIdSchema,
    cellEdits: tableCellEditsSchema,
    rowIndex: z.number().int().min(0).max(1000).optional(),
    columnIndex: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
export const deleteTableOperationSchema = z
  .object({
    type: z.literal('delete_table'),
    paragraphId: editIdSchema,
    cellEdits: tableCellEditsSchema,
    rowIndex: z.number().int().min(0).max(1000).optional(),
    columnIndex: z.number().int().min(0).max(1000).optional(),
  })
  .strict()
