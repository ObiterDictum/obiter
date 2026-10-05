import { describe, expect, it } from 'bun:test'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@obiter/contracts'
import type { ApiEnv } from './env'
import { createTestApiEnv } from './test-api-env'
import { emailAndPasswordOptions } from './auth'

const baseEnv: ApiEnv = createTestApiEnv()

describe('emailAndPasswordOptions — password policy (config regression)', () => {
  // The change-password form states the policy before submission and the
  // reset screen enforces the same floor in the client. Both read the shared
  // contract constants, so the server must be configured from those same
  // values or the form would promise a rule the API does not apply.
  it('pins the password length policy to the shared contract constants', () => {
    const options = emailAndPasswordOptions(baseEnv)

    // Literal first: the shared constants failing to exist would otherwise
    // make this comparison undefined === undefined and pass vacuously.
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(MAX_PASSWORD_LENGTH).toBe(128)
    expect(options.minPasswordLength).toBe(MIN_PASSWORD_LENGTH)
    expect(options.maxPasswordLength).toBe(MAX_PASSWORD_LENGTH)
  })
})
