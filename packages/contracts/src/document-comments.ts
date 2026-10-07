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

/**
 * A half-open UTF-16 range into the model's concatenated paragraph run text.
 * `endParagraphId` carries the paragraph the range ends in when it is not the
 * start paragraph; absent or equal to `paragraphId` keeps the range inside one
 * paragraph. A collapsed `startOffset === endOffset` is an insertion point.
 */
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
    /**
     * Per-intent idempotency key: a retry of the same submit returns the
     * comment already created rather than storing a duplicate.
     */
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

/**
 * A thread reply, discriminated by provenance: a `imported: false` reply was
 * authored in Obiter and stored in the database; an `imported: true` entry was
 * read out of the package's own comments part (an author name or date it does
 * not carry stays null rather than being invented).
 */
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

/** The stored comment row: no model-derived honesty fields belong here. */
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

/**
 * The comment the API serves: the stored row plus replies and whether its
 * stored anchor still resolves in the current document version. An orphaned
 * anchor stays listed as unresolved; it is never re-anchored by content.
 */
export const documentCommentSchema = documentCommentRecordSchema
  .extend({
    replies: z.array(documentCommentReplySchema),
    anchorResolved: z.boolean(),
  })
  .strict()
export type DocumentComment = z.infer<typeof documentCommentSchema>

/**
 * A comment read out of the package's own `word/comments.xml`. Identity is
 * `ooxml-<w:id>`, which cannot collide with database `cmt_` ids; `ooxmlId` is
 * null when the source element carries no usable `w:id`, and such a comment
 * cannot accept replies because it has no stable identity to key them to.
 * `anchor` is null when the comment's range markers do not resolve to model
 * paragraphs; the comment still displays rather than being dropped.
 */
export const documentImportedCommentSchema = z
  .object({
    id: z.string().min(1).max(64),
    ooxmlId: z.number().int().nonnegative().nullable(),
    author: z.string().max(1000).nullable(),
    createdAt: z.string().max(64).nullable(),
    body: z.string().max(DOCUMENT_IMPORTED_COMMENT_BODY_MAX_LENGTH),
    bodyTruncated: z.boolean(),
    /** The `w14:paraId` of the comment's own paragraph, kept so a product reply can thread under it on export. */
    paraId: z.string().max(64).nullable(),
    anchor: documentCommentAnchorSchema.nullable(),
    /** The file's own `w15:done` state; the version is immutable, so Obiter does not write it. */
    resolved: z.boolean(),
    /** The imported id of this comment's thread head when it is a reply. */
    parentId: z.string().max(64).nullable(),
  })
  .strict()
export type DocumentImportedComment = z.infer<
  typeof documentImportedCommentSchema
>

/** An imported comment with its product-authored replies attached. */
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
    /**
     * Product replies whose imported thread is absent from the current
     * version: surfaced honestly instead of disappearing with it.
     */
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
