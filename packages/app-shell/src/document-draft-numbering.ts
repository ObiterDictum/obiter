import { z } from 'zod'
import { DOCUMENT_EDIT_NUMBERING_START_MAX } from '@obiter/contracts'

export const numberingDraftSchema = z
  .object({
    numId: z.string().min(1).nullable(),
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
