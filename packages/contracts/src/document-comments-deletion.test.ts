import { expect, it } from 'bun:test'
import {
  documentCommentDeleteRequestSchema,
  documentCommentRestoreRequestSchema,
  documentCommentDeleteResponseSchema,
  documentCommentRestoreResponseSchema,
} from './document-comments'
it('delete and restore accept only empty requests and nonempty comment identifiers', () => {
  for (const schema of [
    documentCommentDeleteRequestSchema,
    documentCommentRestoreRequestSchema,
  ]) {
    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ authorId: 'other' }).success).toBe(false)
  }
  for (const schema of [
    documentCommentDeleteResponseSchema,
    documentCommentRestoreResponseSchema,
  ]) {
    expect(schema.safeParse({ commentId: 'cmt_1' }).success).toBe(true)
    expect(schema.safeParse({ commentId: '' }).success).toBe(false)
  }
})
