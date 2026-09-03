import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_OPERATION_MAX_COUNT,
  DOCUMENT_EDIT_RUN_MAX_COUNT,
  DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX,
  DOCUMENT_EDIT_TEXT_MAX_LENGTH,
  DOCUMENT_EDIT_TWIP_MAX,
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
            colour: 'C00000',
          },
          {
            type: 'set_paragraph_format',
            paragraphId: 'para_1',
            alignment: 'center',
            spaceBefore: 240,
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
      'emphasis with no assigned property',
      {
        baseVersionId: 'ver_1',
        operations: [{ type: 'set_run_emphasis', runId: 'run_1' }],
      },
    ],
    [
      'paragraph format with no assigned property',
      {
        baseVersionId: 'ver_1',
        operations: [{ type: 'set_paragraph_format', paragraphId: 'para_1' }],
      },
    ],
    [
      'an overlong font name',
      {
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            runId: 'run_1',
            fontFamily: 'A'.repeat(DOCUMENT_EDIT_FONT_NAME_MAX_LENGTH + 1),
          },
        ],
      },
    ],
    [
      'a malformed colour',
      {
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            runId: 'run_1',
            colour: '#C00000',
          },
        ],
      },
    ],
    [
      'an oversized font size',
      {
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            runId: 'run_1',
            fontSize: DOCUMENT_EDIT_SIZE_HALF_POINTS_MAX + 1,
          },
        ],
      },
    ],
    [
      'an oversized spacing value',
      {
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_paragraph_format',
            paragraphId: 'para_1',
            spaceBefore: DOCUMENT_EDIT_TWIP_MAX + 1,
          },
        ],
      },
    ],
    [
      'firstLine and hanging together',
      {
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_paragraph_format',
            paragraphId: 'para_1',
            indentation: { firstLine: 240, hanging: 240 },
          },
        ],
      },
    ],
  ])('rejects %s', (_label, request) => {
    expect(documentEditRequestSchema.safeParse(request).success).toBe(false)
  })

  it('accepts insert_paragraph_after with styled runs and rejects mixed payloads', () => {
    expect(
      documentEditRequestSchema.parse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'insert_paragraph_after',
            paragraphId: 'para_1',
            runs: [
              { text: 'Plain ' },
              { text: 'bold', bold: true },
              {
                text: 'italic',
                italic: true,
                styleId: 'Heading1Char',
              },
            ],
          },
        ],
      }).operations[0],
    ).toMatchObject({
      type: 'insert_paragraph_after',
      runs: [
        { text: 'Plain ' },
        { text: 'bold', bold: true },
        { text: 'italic', italic: true, styleId: 'Heading1Char' },
      ],
    })
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'insert_paragraph_after',
            paragraphId: 'para_1',
            text: 'Both',
            runs: [{ text: 'Both' }],
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'insert_paragraph_after',
            paragraphId: 'para_1',
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects insert runs that exceed count or total text limits', () => {
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'insert_paragraph_after',
            paragraphId: 'para_1',
            runs: Array.from(
              { length: DOCUMENT_EDIT_RUN_MAX_COUNT + 1 },
              () => ({ text: 'x' }),
            ),
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'insert_paragraph_after',
            paragraphId: 'para_1',
            runs: [
              { text: 'x'.repeat(DOCUMENT_EDIT_TEXT_MAX_LENGTH) },
              { text: 'y' },
            ],
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'insert_paragraph_after',
            paragraphId: 'para_1',
            runs: [{ text: 'x'.repeat(DOCUMENT_EDIT_TEXT_MAX_LENGTH) }],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts set_run_emphasis range addressing and rejects mixed or empty ranges', () => {
    expect(
      documentEditRequestSchema.parse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            paragraphId: 'para_1',
            from: 4,
            to: 9,
            bold: true,
            colour: 'C00000',
          },
        ],
      }).operations[0],
    ).toEqual({
      type: 'set_run_emphasis',
      paragraphId: 'para_1',
      from: 4,
      to: 9,
      bold: true,
      colour: 'C00000',
    })
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            runId: 'run_1',
            paragraphId: 'para_1',
            from: 0,
            to: 1,
            bold: true,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            paragraphId: 'para_1',
            from: 9,
            to: 4,
            bold: true,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            paragraphId: 'para_1',
            from: 4,
            to: 4,
            bold: true,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      documentEditRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        operations: [
          {
            type: 'set_run_emphasis',
            paragraphId: 'para_1',
            from: 0,
            bold: true,
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('replays a persisted pre-property-family emphasis operation', () => {
    expect(
      documentEditRequestSchema.parse({
        baseVersionId: 'ver_1',
        operations: [{ type: 'set_run_emphasis', runId: 'run_1', bold: true }],
      }).operations[0],
    ).toEqual({ type: 'set_run_emphasis', runId: 'run_1', bold: true })
  })

  it('treats null as unset and omitted as leave-alone', () => {
    expect(
      documentEditRequestSchema.parse({
        baseVersionId: 'ver_1',
        operations: [{ type: 'set_run_emphasis', runId: 'run_1', bold: null }],
      }).operations[0],
    ).toEqual({ type: 'set_run_emphasis', runId: 'run_1', bold: null })
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
