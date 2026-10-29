import { describe, expect, it } from 'bun:test'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@obiter/contracts'
import type { ApiEnv } from './env'
import { createTestApiEnv } from './test-api-env'
import { emailAndPasswordOptions } from './auth'

const baseEnv: ApiEnv = createTestApiEnv()

describe('emailAndPasswordOptions — password policy (config regression)', () => {
  it('pins the password length policy to the shared contract constants', () => {
    const options = emailAndPasswordOptions(baseEnv)

    expect(MIN_PASSWORD_LENGTH).toBe(8)
    expect(MAX_PASSWORD_LENGTH).toBe(128)
    expect(options.minPasswordLength).toBe(MIN_PASSWORD_LENGTH)
    expect(options.maxPasswordLength).toBe(MAX_PASSWORD_LENGTH)
  })
})
