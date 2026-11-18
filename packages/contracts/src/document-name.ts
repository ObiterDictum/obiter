import { z } from 'zod'
import { checkDocumentName } from './document-name-rules'

export {
  checkDocumentName,
  DEFAULT_DOCUMENT_NAME,
  DOCUMENT_NAME_MAX_LENGTH,
} from './document-name-rules'

export const documentNameSchema = z.string().transform((input, context) => {
  const checked = checkDocumentName(input)
  if (checked.ok) return checked.name
  context.addIssue({ code: 'custom', message: checked.error })
  return z.NEVER
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
