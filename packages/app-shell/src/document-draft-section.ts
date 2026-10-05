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

/**
 * The persisted shape of a pending section draft. It must admit every
 * `SectionDraft` field, because `writeDocumentDraft` serialises the in-memory
 * entries verbatim and `scanPayloads` deletes a payload it cannot parse, which
 * would destroy the whole unsaved draft. Bounds come from the edit contract so
 * persistence and save cannot disagree.
 */
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

/** The persisted shape of one pending page or section break. */
export const breakDraftSchema = z
  .object({
    id: z.string().min(1),
    paragraphId: z.string().min(1),
    offset: z.number().int().min(0),
    kind: z.enum(['page', 'section']),
  })
  .strict()
