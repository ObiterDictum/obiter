import { z } from 'zod'
import { documentTextRunWireSchema } from '@obiter/contracts'
import { pendingEmphasisSchema } from './document-draft-emphasis'
import { numberingDraftSchema } from './document-draft-numbering'
import { paragraphFormatDraftSchema } from './document-draft-paragraph-format'
import { breakDraftSchema, sectionDraftSchema } from './document-draft-section'
import { structuralDraftsFieldSchema } from './document-structural-drafts'
import { DOCUMENT_DRAFT_SCHEMA_VERSION } from './document-draft-identity'

const localInsertSchema = z
  .object({
    clientId: z.string().min(1),
    afterParagraphId: z.string().min(1),
    beforeParagraphId: z.string().min(1).optional(),
    text: z.string(),
    runs: z.array(documentTextRunWireSchema).optional(),
  })
  .strict()

const trackedRejectionSchema = z
  .object({
    key: z.string().min(1),
    ooxmlIds: z.array(z.string().min(1)).min(1),
    removeParagraphIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
const draftStateSchema = z
  .object({
    drafts: z.record(z.string(), z.string()),
    inserts: z.array(localInsertSchema),
    deletedParagraphIds: z.array(z.string().min(1)),
    extraRuns: z.record(z.string(), z.array(documentTextRunWireSchema)),
    format: z
      .object({
        emphasis: z.array(pendingEmphasisSchema),
        paragraphStyles: z.record(z.string(), z.string().min(1).nullable()),
        numbering: z.record(z.string(), numberingDraftSchema),
        paragraphFormats: z
          .record(z.string(), paragraphFormatDraftSchema)
          .optional()
          .default({}),
        section: sectionDraftSchema.optional().default({}),
      })
      .strict(),
    breaks: z.array(breakDraftSchema).optional().default([]),
    structures: structuralDraftsFieldSchema,
    trackedRejections: z.array(trackedRejectionSchema).optional().default([]),
  })
  .strict()

const heldChangeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    reason: z.string(),
    createdAt: z.string(),
    state: draftStateSchema,
  })
  .strict()

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(DOCUMENT_DRAFT_SCHEMA_VERSION),
    organisationId: z.string().min(1),
    userId: z.string().min(1),
    documentId: z.string().min(1),
    draftId: z.string().min(1).optional(),
    writerId: z.string().min(1).optional(),
    status: z.enum(['active', 'parked']).optional(),
    baseVersionId: z.string().min(1),
    updatedAt: z.string(),
    trackChangesFlip: z.boolean().optional(),
    state: draftStateSchema,
    held: z.array(heldChangeSchema),
  })
  .strict()

export type HeldChange = z.infer<typeof heldChangeSchema>
export type DocumentDraftSnapshot = z.infer<typeof snapshotSchema>

export function parseDraftSnapshot(raw: string): DocumentDraftSnapshot | null {
  try {
    const result = snapshotSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
