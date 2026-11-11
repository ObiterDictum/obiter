import { z } from 'zod'

const id = z.string().min(1)
const timestamp = z.string().datetime({ offset: true })
const content = z.string().trim().min(1)
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const organisationAgentMemorySchema = z
  .object({
    organisationId: id,
    standingInstructions: z.string(),
    updatedBy: id,
    updatedAt: timestamp,
  })
  .strict()
export type OrganisationAgentMemory = z.infer<
  typeof organisationAgentMemorySchema
>
export const organisationAgentMemoryUpdateRequestSchema = z
  .object({ standingInstructions: z.string() })
  .strict()
export type OrganisationAgentMemoryUpdateRequest = z.infer<
  typeof organisationAgentMemoryUpdateRequestSchema
>

const playbookFields = {
  slug,
  title: content,
  triggerDescription: content,
  bodyMarkdown: content,
  enabled: z.boolean(),
}
export const organisationPlaybookSchema = z
  .object({
    id,
    organisationId: id,
    ...playbookFields,
    updatedBy: id,
    updatedAt: timestamp,
  })
  .strict()
export type OrganisationPlaybook = z.infer<typeof organisationPlaybookSchema>
export const organisationPlaybookCreateRequestSchema = z
  .object(playbookFields)
  .strict()
export type OrganisationPlaybookCreateRequest = z.infer<
  typeof organisationPlaybookCreateRequestSchema
>
export const organisationPlaybookUpdateRequestSchema = z
  .object(playbookFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change.')
export type OrganisationPlaybookUpdateRequest = z.infer<
  typeof organisationPlaybookUpdateRequestSchema
>
export const organisationPlaybookListResponseSchema = z
  .object({ playbooks: z.array(organisationPlaybookSchema) })
  .strict()
export type OrganisationPlaybookListResponse = z.infer<
  typeof organisationPlaybookListResponseSchema
>

export const userAgentMemoryProvenanceSchema = z.enum([
  'user_entered',
  'confirmed_suggestion',
  'imported',
])
export type UserAgentMemoryProvenance = z.infer<
  typeof userAgentMemoryProvenanceSchema
>
export const userAgentMemorySchema = z
  .object({
    id,
    organisationId: id,
    userId: id,
    content,
    provenance: userAgentMemoryProvenanceSchema,
    createdAt: timestamp,
  })
  .strict()
export type UserAgentMemory = z.infer<typeof userAgentMemorySchema>
export const userAgentMemoryCreateRequestSchema = z
  .object({ content, provenance: userAgentMemoryProvenanceSchema })
  .strict()
export type UserAgentMemoryCreateRequest = z.infer<
  typeof userAgentMemoryCreateRequestSchema
>
export const userAgentMemoryUpdateRequestSchema = z.object({ content }).strict()
export type UserAgentMemoryUpdateRequest = z.infer<
  typeof userAgentMemoryUpdateRequestSchema
>
export const userAgentMemoryListResponseSchema = z
  .object({
    enabled: z.boolean(),
    items: z.array(userAgentMemorySchema).max(25),
  })
  .strict()
export type UserAgentMemoryListResponse = z.infer<
  typeof userAgentMemoryListResponseSchema
>
export const userAgentMemorySettingsUpdateRequestSchema = z
  .object({ enabled: z.boolean() })
  .strict()
export type UserAgentMemorySettingsUpdateRequest = z.infer<
  typeof userAgentMemorySettingsUpdateRequestSchema
>
export const userAgentMemoryImportRequestSchema = z
  .object({ markdown: content })
  .strict()
export type UserAgentMemoryImportRequest = z.infer<
  typeof userAgentMemoryImportRequestSchema
>
export const userAgentMemoryExportResponseSchema = z
  .object({ markdown: z.string() })
  .strict()
export type UserAgentMemoryExportResponse = z.infer<
  typeof userAgentMemoryExportResponseSchema
>

export const matterAgentMemorySchema = z
  .object({
    id,
    organisationId: id,
    matterId: id,
    content,
    createdBy: id,
    updatedAt: timestamp,
  })
  .strict()
export type MatterAgentMemory = z.infer<typeof matterAgentMemorySchema>
export const matterAgentMemoryCreateRequestSchema = z
  .object({ content })
  .strict()
export type MatterAgentMemoryCreateRequest = z.infer<
  typeof matterAgentMemoryCreateRequestSchema
>
export const matterAgentMemoryUpdateRequestSchema = z
  .object({ content })
  .strict()
export type MatterAgentMemoryUpdateRequest = z.infer<
  typeof matterAgentMemoryUpdateRequestSchema
>
export const matterAgentMemoryListResponseSchema = z
  .object({ items: z.array(matterAgentMemorySchema) })
  .strict()
export type MatterAgentMemoryListResponse = z.infer<
  typeof matterAgentMemoryListResponseSchema
>

export const memorySuggestionSchema = z.object({ id, content }).strict()
export type MemorySuggestion = z.infer<typeof memorySuggestionSchema>
