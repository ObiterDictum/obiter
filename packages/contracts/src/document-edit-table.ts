import { z } from 'zod'
import { isValidXmlText } from './xml-text'
import { editIdSchema } from './document-edit-shared'

export const tableCellEditsSchema = z
  .array(
    z
      .object({
        row: z.number().int().min(0).max(1000),
        column: z.number().int().min(0).max(1000),
        text: z.string().max(100000).refine(isValidXmlText),
      })
      .strict(),
  )
  .max(10000)
  .optional()

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
