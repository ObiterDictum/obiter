import '@obiter/test-dom'
import { describe, expect, it, beforeEach } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { act, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import {
  createWrapper,
  refetch,
  useAuth,
  useSession,
  verifyBackupCode,
  verifyTotp,
} from './auth-test-support'

beforeEach(() => {
  vi.clearAllMocks()
  refetch.mockResolvedValue(undefined)
  useSession.mockReturnValue({ data: null, isPending: false, refetch })
})

describe('useAuth — two-factor sign-in verification', () => {
  it('verifies a TOTP code and refreshes the session', async () => {
    verifyTotp.mockResolvedValueOnce({ error: null, data: { token: 'tok' } })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '123456' })
    })

    expect(verifyTotp).toHaveBeenCalledWith({ code: '123456' })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ ok: true })
  })

  it('verifies a backup code through the backup-code endpoint', async () => {
    verifyBackupCode.mockResolvedValueOnce({
      error: null,
      data: { token: 'tok' },
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    await act(async () => {
      await result.current.verifyTwoFactorSignIn({
        code: 'abcd-efgh',
        backupCode: true,
      })
    })

    expect(verifyBackupCode).toHaveBeenCalledWith({ code: 'abcd-efgh' })
    expect(verifyTotp).not.toHaveBeenCalled()
  })

  it('explains a wrong code without exposing server detail', async () => {
    verifyTotp.mockResolvedValueOnce({
      error: { message: 'Invalid code', code: 'INVALID_CODE' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '000000' })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'That code is not correct. Check it and try again.',
      code: 'INVALID_CODE',
    })
    expect(refetch).not.toHaveBeenCalled()
  })

  it('tells the user to restart sign-in after too many attempts', async () => {
    verifyTotp.mockResolvedValueOnce({
      error: {
        message: 'Too many attempts',
        code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '000000' })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Too many incorrect attempts. Start sign-in again.',
      code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
    })
  })

  it('reports an expired challenge cookie', async () => {
    verifyTotp.mockResolvedValueOnce({
      error: { message: 'Bad cookie', code: 'INVALID_TWO_FACTOR_COOKIE' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({ code: '123456' })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Your sign-in timed out. Start again.',
      code: 'INVALID_TWO_FACTOR_COOKIE',
    })
  })

  it('explains that a used or unknown backup code works once', async () => {
    verifyBackupCode.mockResolvedValueOnce({
      error: { message: 'Invalid backup code', code: 'INVALID_BACKUP_CODE' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({
        code: 'aaaaa-bbbbb',
        backupCode: true,
      })
    })

    expect(outcome).toEqual({
      ok: false,
      message:
        'That backup code is not valid or has already been used. Each backup code works once.',
      code: 'INVALID_BACKUP_CODE',
    })
    expect(verifyTotp).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
  })

  it('keeps the generic message for an unrecognised backup-code failure', async () => {
    verifyBackupCode.mockResolvedValueOnce({
      error: { message: 'Failed to verify backup code. Please try again.' },
      data: null,
    })

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(new QueryClient()),
    })

    let outcome
    await act(async () => {
      outcome = await result.current.verifyTwoFactorSignIn({
        code: 'aaaaa-bbbbb',
        backupCode: true,
      })
    })

    expect(outcome).toEqual({
      ok: false,
      message: 'Could not verify your second factor. Try again.',
      code: undefined,
    })
  })
})
