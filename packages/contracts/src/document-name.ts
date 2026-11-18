import { z } from 'zod'

export const DOCUMENT_NAME_MAX_LENGTH = 200

export const DEFAULT_DOCUMENT_NAME = 'Untitled document'

const forbiddenDocumentNameCharacter = /[/\\\p{Cc}]/u

export const documentNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a document name.')
  .max(
    DOCUMENT_NAME_MAX_LENGTH,
    `Use ${DOCUMENT_NAME_MAX_LENGTH} characters or fewer.`,
  )
  .refine((name) => !forbiddenDocumentNameCharacter.test(name), {
    message: 'Names cannot contain slashes or control characters.',
  })

export const documentRenameRequestSchema = z
  .object({ name: documentNameSchema })
  .strict()
export type DocumentRenameRequest = z.infer<typeof documentRenameRequestSchema>

export const documentRenameResponseSchema = z.object({
  document: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
  }),
})
export type DocumentRenameResponse = z.infer<
  typeof documentRenameResponseSchema
>
