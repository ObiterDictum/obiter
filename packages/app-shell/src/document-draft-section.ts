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

export const sectionDraftSchema = z
  .object({
    margins: z
      .object({
        top: twip.nullable().optional(),
        right: twip.nullable().optional(),
        bottom: twip.nullable().optional(),
        left: twip.nullable().optional(),
        header: twip.nullable().optional(),
        footer: twip.nullable().optional(),
        gutter: twip.nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    orientation: z.enum(['portrait', 'landscape']).nullable().optional(),
    pageSize: z
      .object({ width: twip, height: twip })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()

export const breakDraftSchema = z
  .object({
    id: z.string().min(1),
    paragraphId: z.string().min(1),
    offset: z.number().int().min(0),
    kind: z.enum(['page', 'section']),
  })
  .strict()
