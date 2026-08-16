import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_EDIT_OPERATION_MAX_COUNT,
  DOCUMENT_EDIT_TEXT_MAX_LENGTH,
  documentEditRequestSchema,
  documentEditResponseSchema,
} from './document-edit'

describe('document edit contracts', () => {
  const operation = {
    type: 'replace_run_text' as const,
    runId: 'run_1',
    text: 'Revised',
  }

  it('accepts the typed operation surface and exact response', () => {
    expect(
      documentEditRequestSchema.parse({
        baseVersionId: 'ver_1',
        operations: [
          operation,
          { type: 'set_run_style', runId: 'run_1', styleId: null },
          {
            type: 'set_paragraph_style',
            paragraphId: 'para_1',
            styleId: 'Heading1',
          },
          {
            type: 'set_run_emphasis',
            runId: 'run_1',
            bold: true,
          },
          {
            type: 'set_paragraph_numbering',
            paragraphId: 'para_1',
            numId: '1',
            ilvl: 1,
          },
          {
            type: 'insert_paragraph_after',
            paragraphId: 'para_1',
            text: 'Next',
          },
          { type: 'delete_paragraph', paragraphId: 'para_2' },
        ],
      }),
    ).toMatchObject({ trackChanges: false })
    expect(
      documentEditRequestSchema.parse({
        baseVersionId: 'ver_1',
        operations: [operation],
        trackChanges: true,
      }),
    ).toMatchObject({ trackChanges: true })
    expect(
      documentEditResponseSchema.parse({
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
      }),
    ).toEqual({ documentId: 'doc_1', versionId: 'ver_2', versionNumber: 2 })
  })

  it.each([
    ['an empty operation list', { baseVersionId: 'ver_1', operations: [] }],
    [
      'too many operations',
      {
        baseVersionId: 'ver_1',
        operations: Array.from(
          { length: DOCUMENT_EDIT_OPERATION_MAX_COUNT + 1 },
          () => operation,
        ),
      },
    ],
    [
      'overlong text',
      {
        baseVersionId: 'ver_1',
        operations: [
          { ...operation, text: 'x'.repeat(DOCUMENT_EDIT_TEXT_MAX_LENGTH + 1) },
        ],
      },
    ],
    [
      'an unsupported XML character',
      {
        baseVersionId: 'ver_1',
        operations: [{ ...operation, text: 'bad\u0000text' }],
      },
    ],
    [
      'a blank target id',
      {
        baseVersionId: 'ver_1',
        operations: [{ ...operation, runId: '   ' }],
      },
    ],
    [
      'a client model payload',
      {
        baseVersionId: 'ver_1',
        operations: [operation],
        model: { version: 1 },
      },
    ],
    [
      'numbering without an ilvl',
      {
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_paragraph_numbering',
            paragraphId: 'para_1',
            numId: '1',
          },
        ],
      },
    ],
    [
      'emphasis with no set flag',
      {
        baseVersionId: 'ver_1',
        operations: [{ type: 'set_run_emphasis', runId: 'run_1', bold: null }],
      },
    ],
  ])('rejects %s', (_label, request) => {
    expect(documentEditRequestSchema.safeParse(request).success).toBe(false)
  })

  it('accepts numbering without an ilvl when the numbering is cleared', () => {
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_paragraph_numbering',
            paragraphId: 'para_1',
            numId: null,
          },
        ],
      }).success,
    ).toBe(true)
  })
})
