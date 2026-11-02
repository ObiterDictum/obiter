import { describe, expect, it } from 'bun:test'
import {
  documentCommentReplySchema,
  documentCommentSchema,
} from './document-comments'
import { matterShareListResponseSchema } from './index'
import { personAttributionSchema } from './person'
import { verificationFindingDismissalSchema } from './verification'

const alex = { id: 'usr_1', name: 'Alex Morgan' }

describe('person attribution', () => {
  it('accepts a person without the marker so a response from an older backend still parses', () => {
    expect(personAttributionSchema.parse(alex)).toEqual(alex)
  })

  it('keeps a former member distinguishable from a current member', () => {
    expect(
      personAttributionSchema.parse({ ...alex, formerMember: true }),
    ).toEqual({ ...alex, formerMember: true })
  })

  it('refuses a person without an identity or a name', () => {
    expect(
      personAttributionSchema.safeParse({ name: 'Alex Morgan' }).success,
    ).toBe(false)
    expect(personAttributionSchema.safeParse({ id: 'usr_1' }).success).toBe(
      false,
    )
  })
})

describe('former member marker on author responses', () => {
  it('marks a comment author and a reply author who has left the organisation', () => {
    const comment = {
      id: 'cmt_1',
      documentId: 'doc_1',
      anchorVersionId: 'ver_1',
      anchor: { paragraphId: 'p1', startOffset: 0, endOffset: 4 },
      body: 'Check this wording',
      author: { ...alex, formerMember: true },
      resolvedAt: null,
      resolvedBy: null,
      createdAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      replies: [],
      anchorResolved: true,
    }
    expect(documentCommentSchema.parse(comment).author.formerMember).toBe(true)
    const reply = {
      imported: false as const,
      id: 'rep_1',
      body: 'Agreed',
      author: { ...alex, formerMember: true },
      createdAt: '2026-11-02T00:00:00.000Z',
    }
    expect(documentCommentReplySchema.parse(reply).author).toEqual({
      ...alex,
      formerMember: true,
    })
  })

  it('marks a Verify dismissal by a former member without inventing a name', () => {
    const dismissal = {
      reason: null,
      dismissedBy: 'usr_1',
      dismissedByName: 'Alex Morgan',
      dismissedByFormerMember: true,
      dismissedAt: '2026-11-02T00:00:00.000Z',
    }
    expect(verificationFindingDismissalSchema.parse(dismissal)).toEqual(
      dismissal,
    )
    expect(
      verificationFindingDismissalSchema.parse({
        ...dismissal,
        dismissedByName: null,
      }).dismissedByName,
    ).toBeNull()
  })

  it('names the matter owner on the share list while keeping the legacy owner id', () => {
    const response = {
      ownerUserId: 'usr_1',
      owner: { ...alex, formerMember: true },
      shares: [],
    }
    expect(matterShareListResponseSchema.parse(response)).toEqual(response)
    expect(
      matterShareListResponseSchema.parse({ ownerUserId: 'usr_1', shares: [] }),
    ).toEqual({ ownerUserId: 'usr_1', shares: [] })
  })
})
