import { z } from 'zod'

export const DOCUMENT_COMMENT_BODY_MAX_LENGTH = 10_000
export const DOCUMENT_COMMENT_AUTHOR_NAME_MAX_LENGTH = 200

const plainTextSchema = z.string().refine(isValidXmlText, {
  message: 'Comment text contains an unsupported XML character.',
})

function isValidXmlText(value: string) {
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index)
    if (codePoint === undefined) return false
    const valid =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10_000 && codePoint <= 0x10_ffff)
    if (!valid) return false
    index += codePoint > 0xffff ? 2 : 1
  }
  return true
}

export const documentCommentAnchorSchema = z
  .object({
    paragraphId: z.string().trim().min(1).max(255),
    startOffset: z.number().int().nonnegative().max(2_147_483_647),
    endOffset: z.number().int().nonnegative().max(2_147_483_647),
  })
  .strict()
  .refine((anchor) => anchor.startOffset <= anchor.endOffset, {
    path: ['endOffset'],
    message: 'Comment anchor end must not precede its start.',
  })
export type DocumentCommentAnchor = z.infer<typeof documentCommentAnchorSchema>

export const documentCommentCreateRequestSchema = z
  .object({
    body: plainTextSchema
      .refine((value) => value.trim().length > 0, {
        message: 'Comment body must not be blank.',
      })
      .refine((value) => value.length <= DOCUMENT_COMMENT_BODY_MAX_LENGTH, {
        message: 'Comment body is too long.',
      }),
    anchor: documentCommentAnchorSchema,
  })
  .strict()
export type DocumentCommentCreateRequest = z.infer<
  typeof documentCommentCreateRequestSchema
>

const documentCommentUserSchema = z
  .object({
    id: z.string().min(1),
    name: plainTextSchema
      .refine((value) => value.trim().length > 0)
      .refine(
        (value) => value.length <= DOCUMENT_COMMENT_AUTHOR_NAME_MAX_LENGTH,
      ),
  })
  .strict()

export const documentCommentSchema = z
  .object({
    id: z.string().min(1),
    documentId: z.string().min(1),
    anchorVersionId: z.string().min(1).nullable(),
    anchor: documentCommentAnchorSchema,
    body: plainTextSchema
      .refine((value) => value.trim().length > 0)
      .refine((value) => value.length <= DOCUMENT_COMMENT_BODY_MAX_LENGTH),
    author: documentCommentUserSchema,
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    resolvedBy: z.string().min(1).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
export type DocumentComment = z.infer<typeof documentCommentSchema>

export const documentCommentListResponseSchema = z
  .object({ comments: z.array(documentCommentSchema) })
  .strict()
export type DocumentCommentListResponse = z.infer<
  typeof documentCommentListResponseSchema
>

export const documentCommentCreateResponseSchema = z
  .object({ comment: documentCommentSchema })
  .strict()
export type DocumentCommentCreateResponse = z.infer<
  typeof documentCommentCreateResponseSchema
>

export const documentCommentResolveRequestSchema = z.object({}).strict()
export type DocumentCommentResolveRequest = z.infer<
  typeof documentCommentResolveRequestSchema
>

export const documentCommentResolveResponseSchema = z
  .object({ comment: documentCommentSchema })
  .strict()
export type DocumentCommentResolveResponse = z.infer<
  typeof documentCommentResolveResponseSchema
>
