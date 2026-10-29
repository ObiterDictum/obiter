import { describe, expect, it } from 'bun:test'

import {
  documentKindSchema,
  documentMarkingsRequestSchema,
  documentMarkingsStateSchema,
  documentMarkingsWireSchema,
} from './document-markings'

describe('document markings contract', () => {
  it('keeps a stored document kind this deployment does not list', () => {
    const markings = {
      documentKind: 'affidavit',
      draft: true,
      privileged: false,
      withoutPrejudice: false,
    }

    expect(documentKindSchema.safeParse('affidavit').success).toBe(false)
    expect(documentMarkingsWireSchema.parse(markings)).toEqual(markings)
    expect(
      documentMarkingsRequestSchema.parse({
        baseVersionId: 'ver_1',
        markings,
      }),
    ).toMatchObject({ markings })
    expect(
      documentMarkingsStateSchema.parse({ ...markings, unreadable: true }),
    ).toMatchObject({ unreadable: true })
  })
})
