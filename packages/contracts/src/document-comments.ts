import { z } from 'zod'

import { isValidXmlText } from './xml-text'

export const DOCUMENT_COMMENT_BODY_MAX_LENGTH = 10_000
export const DOCUMENT_COMMENT_AUTHOR_NAME_MAX_LENGTH = 200
export const DOCUMENT_COMMENT_CLIENT_KEY_MAX_LENGTH = 64
export const DOCUMENT_IMPORTED_COMMENT_BODY_MAX_LENGTH = 100_000

const COMMENT_OFFSET_MAX = 2_147_483_647

const plainTextSchema = z.string().refine(isValidXmlText, {
  message: 'Comment text contains an unsupported XML character.',
})

const commentBodySchema = plainTextSchema
  .refine((value) => value.trim().length > 0, {
    message: 'Comment body must not be blank.',
  })
  .refine((value) => value.length <= DOCUMENT_COMMENT_BODY_MAX_LENGTH, {
    message: 'Comment body is too long.',
  })

const clientKeySchema = z
  .string()
  .min(1)
  .max(DOCUMENT_COMMENT_CLIENT_KEY_MAX_LENGTH)

export const documentCommentAnchorSchema = z
  .object({
    paragraphId: z.string().trim().min(1).max(255),
    startOffset: z.number().int().nonnegative().max(COMMENT_OFFSET_MAX),
    endOffset: z.number().int().nonnegative().max(COMMENT_OFFSET_MAX),
    endParagraphId: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .refine(
    (anchor) =>
      anchor.endParagraphId !== undefined &&
      anchor.endParagraphId !== anchor.paragraphId
        ? true
        : anchor.startOffset <= anchor.endOffset,
    {
      path: ['endOffset'],
      message: 'Comment anchor end must not precede its start.',
    },
  )
export type DocumentCommentAnchor = z.infer<typeof documentCommentAnchorSchema>

export const documentCommentCreateRequestSchema = z
  .object({
    body: commentBodySchema,
    anchor: documentCommentAnchorSchema,
    clientKey: clientKeySchema.optional(),
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

export const documentCommentReplySchema = z.discriminatedUnion('imported', [
  z
    .object({
      imported: z.literal(false),
      id: z.string().min(1),
      body: commentBodySchema,
      author: documentCommentUserSchema,
      createdAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      imported: z.literal(true),
      id: z.string().min(1),
      body: z.string().max(DOCUMENT_IMPORTED_COMMENT_BODY_MAX_LENGTH),
      author: z.object({ name: z.string().max(1000).nullable() }).strict(),
      createdAt: z.string().max(64).nullable(),
    })
    .strict(),
])
export type DocumentCommentReply = z.infer<typeof documentCommentReplySchema>

export const documentCommentReplyCreateRequestSchema = z
  .object({
    body: commentBodySchema,
    clientKey: clientKeySchema.optional(),
  })
  .strict()
export type DocumentCommentReplyCreateRequest = z.infer<
  typeof documentCommentReplyCreateRequestSchema
>

export const documentCommentRecordSchema = z
  .object({
    id: z.string().min(1),
    documentId: z.string().min(1),
    anchorVersionId: z.string().min(1).nullable(),
    anchor: documentCommentAnchorSchema,
    body: commentBodySchema,
    author: documentCommentUserSchema,
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    resolvedBy: z.string().min(1).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
export type DocumentCommentRecord = z.infer<typeof documentCommentRecordSchema>

export const documentCommentSchema = documentCommentRecordSchema
  .extend({
    replies: z.array(documentCommentReplySchema),
    anchorResolved: z.boolean(),
  })
  .strict()
export type DocumentComment = z.infer<typeof documentCommentSchema>

export const documentImportedCommentSchema = z
  .object({
    id: z.string().min(1).max(64),
    ooxmlId: z.number().int().nonnegative().nullable(),
    author: z.string().max(1000).nullable(),
    createdAt: z.string().max(64).nullable(),
    body: z.string().max(DOCUMENT_IMPORTED_COMMENT_BODY_MAX_LENGTH),
    bodyTruncated: z.boolean(),
    paraId: z.string().max(64).nullable(),
    anchor: documentCommentAnchorSchema.nullable(),
    resolved: z.boolean(),
    parentId: z.string().max(64).nullable(),
  })
  .strict()
export type DocumentImportedComment = z.infer<
  typeof documentImportedCommentSchema
>

export const documentImportedCommentThreadSchema = documentImportedCommentSchema
  .extend({ replies: z.array(documentCommentReplySchema) })
  .strict()
export type DocumentImportedCommentThread = z.infer<
  typeof documentImportedCommentThreadSchema
>

export const documentCommentListResponseSchema = z
  .object({
    comments: z.array(documentCommentSchema),
    importedComments: z.array(documentImportedCommentThreadSchema),
    orphanedReplies: z.array(documentCommentReplySchema),
  })
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

export const documentCommentReplyCreateResponseSchema = z
  .object({ reply: documentCommentReplySchema })
  .strict()
export type DocumentCommentReplyCreateResponse = z.infer<
  typeof documentCommentReplyCreateResponseSchema
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

export const documentCommentReopenRequestSchema = z.object({}).strict()
export type DocumentCommentReopenRequest = z.infer<
  typeof documentCommentReopenRequestSchema
>

export const documentCommentReopenResponseSchema = z
  .object({ comment: documentCommentSchema })
  .strict()
export type DocumentCommentReopenResponse = z.infer<
  typeof documentCommentReopenResponseSchema
>
