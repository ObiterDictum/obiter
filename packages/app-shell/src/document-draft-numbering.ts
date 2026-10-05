import { z } from 'zod'
import { DOCUMENT_EDIT_NUMBERING_START_MAX } from '@obiter/contracts'

/**
 * One paragraph's pending list state. `startOverride` restarts the list at a
 * number; absent/`null` leaves the numbering instance as-is. Introduced by E4
 * list restart, so it is absent in older persisted drafts.
 */
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
