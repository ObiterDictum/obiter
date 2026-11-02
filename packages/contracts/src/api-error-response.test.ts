import { describe, expect, it } from 'bun:test'
import { API_ERROR_CODES } from './api-error-codes'
import { parseApiErrorResponse } from './api-error-response'
import { apiErrorResponseSchema } from './api-error'
import { removeOrganisationMemberConflictResponseSchema } from './matter'

function expectAgreement(value: unknown) {
  const parsed = parseApiErrorResponse(value)
  const schema = apiErrorResponseSchema.safeParse(value)
  expect(parsed !== null).toBe(schema.success)
  if (parsed && schema.success) expect(parsed).toEqual(schema.data)
}

describe('parseApiErrorResponse — the light parser matches the zod contract', () => {
  it('accepts every error code the API can send', () => {
    for (const code of API_ERROR_CODES) {
      expectAgreement({
        error: { code, message: 'Request failed.', requestId: 'req_1' },
      })
    }
  })

  it('accepts the extra keys zod strips rather than rejects', () => {
    expectAgreement({
      error: {
        code: 'forbidden',
        message: 'Not allowed.',
        requestId: 'req_1',
        detail: 'ignored',
      },
      trace: 'ignored',
    })
  })

  it('rejects an unknown code, empty message or empty request id', () => {
    expectAgreement({
      error: { code: 'unknown', message: 'Failed.', requestId: 'req_1' },
    })
    expectAgreement({
      error: { code: 'forbidden', message: '', requestId: 'req_1' },
    })
    expectAgreement({
      error: { code: 'forbidden', message: 'Failed.', requestId: '' },
    })
  })

  it('preserves validated uncovered matters without loading schemas in the client entry point', () => {
    const body = {
      error: {
        code: 'conflict_detected',
        message: 'Transfer required.',
        requestId: 'req_1',
        uncoveredMatters: [
          { matterId: 'm1', title: 'Synthetic matter', ignored: true },
        ],
      },
    }
    expect(parseApiErrorResponse(body)).toEqual(
      removeOrganisationMemberConflictResponseSchema.parse(body),
    )
  })

  it('does not expose malformed or unrelated uncovered-matter data', () => {
    for (const uncoveredMatters of [
      [],
      null,
      [{ matterId: 'm1' }],
      [{ matterId: '', title: 'Matter' }],
      [{ matterId: 'm1', title: 42 }],
    ]) {
      expect(
        parseApiErrorResponse({
          error: {
            code: 'conflict_detected',
            message: 'Conflict.',
            requestId: 'req_1',
            uncoveredMatters,
          },
        })?.error.uncoveredMatters,
      ).toBeUndefined()
    }
    expect(
      parseApiErrorResponse({
        error: {
          code: 'forbidden',
          message: 'Forbidden.',
          requestId: 'req_1',
          uncoveredMatters: [{ matterId: 'm1', title: 'Matter' }],
        },
      })?.error.uncoveredMatters,
    ).toBeUndefined()
  })

  it('rejects a body that is not an error envelope', () => {
    expectAgreement(null)
    expectAgreement([])
    expectAgreement('forbidden')
    expectAgreement({})
    expectAgreement({ error: null })
    expectAgreement({ error: [] })
    expectAgreement({ error: { code: 'forbidden', message: 42 } })
    expectAgreement({ error: { code: 'forbidden', requestId: 'req_1' } })
  })
})
