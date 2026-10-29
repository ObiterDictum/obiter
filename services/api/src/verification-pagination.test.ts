import { describe, expect, it } from 'bun:test'
import {
  verificationListDefaultLimit,
  verificationListMaxLimit,
} from '@obiter/contracts'

import {
  cursorFromRow,
  decodeVerificationCursor,
  encodeVerificationCursor,
  resolveRunListLimit,
  VerificationListLimitError,
} from './verification-pagination'

describe('verification cursors', () => {
  it('round-trips a cursor without dropping microseconds', () => {
    const cursor = {
      createdAt: '2026-02-01T10:00:00.123456+00:00',
      id: 'run_1',
    }

    expect(decodeVerificationCursor(encodeVerificationCursor(cursor))).toEqual(
      cursor,
    )
    expect(
      cursorFromRow({ cursor_created_at: cursor.createdAt, id: cursor.id }),
    ).toEqual(cursor)
  })

  it('rejects a cursor that is not the strict payload whole', () => {
    expect(decodeVerificationCursor('not-a-cursor')).toBeNull()
    expect(
      decodeVerificationCursor(
        Buffer.from(
          JSON.stringify({
            createdAt: '2026-02-01T10:00:00.123456+00:00',
            id: 'run_1',
            extra: true,
          }),
          'utf8',
        ).toString('base64url'),
      ),
    ).toBeNull()
    expect(
      decodeVerificationCursor(
        Buffer.from(
          JSON.stringify({
            createdAt: '2026-02-01T10:00:00.123456+00:00',
            id: '',
          }),
          'utf8',
        ).toString('base64url'),
      ),
    ).toBeNull()
  })
})

describe('verification page limits', () => {
  it('rejects a limit outside the contract bounds and defaults when absent', () => {
    expect(resolveRunListLimit(undefined)).toBe(verificationListDefaultLimit)
    expect(resolveRunListLimit(verificationListMaxLimit)).toBe(
      verificationListMaxLimit,
    )

    for (const invalid of [0, -1, 1.5, verificationListMaxLimit + 1]) {
      expect(() => resolveRunListLimit(invalid)).toThrow(
        VerificationListLimitError,
      )
    }
  })
})
