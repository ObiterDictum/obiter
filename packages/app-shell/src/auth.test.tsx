// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useAuth } from './auth'

const mock = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signOutFn: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: mock.useSession,
    signIn: { email: mock.signInEmail },
    signUp: { email: mock.signUpEmail },
    signOut: mock.signOutFn,
  }),
}))

vi.mock('better-auth/client/plugins', () => ({
  magicLinkClient: () => ({}),
}))

const { signInEmail, signUpEmail, useSession } = mock

beforeEach(() => {
  vi.clearAllMocks()
  useSession.mockReturnValue({ data: null, isPending: false })
})

describe('useAuth — sign-in success/failure', () => {
  it('returns ok on a successful email/password sign-in', async () => {
    signInEmail.mockResolvedValueOnce({ error: null, data: { token: 'tok', user: { id: 'usr_1' } } })

    const { result } = renderHook(() => useAuth())

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({ email: 'lex@obiter.dev', password: 'obiter-dev' })
    })

    expect(signInEmail).toHaveBeenCalledWith({ email: 'lex@obiter.dev', password: 'obiter-dev' })
    expect(outcome).toEqual({ ok: true })
  })

  it('surfaces a real error message on a failed sign-in', async () => {
    signInEmail.mockResolvedValueOnce({
      error: { message: 'Invalid email or password.' },
      data: null,
    })

    const { result } = renderHook(() => useAuth())

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({ email: 'lex@obiter.dev', password: 'wrong' })
    })

    expect(outcome).toEqual({ ok: false, message: 'Invalid email or password.' })
  })

  it('falls back to a generic message when better-auth gives no message', async () => {
    signInEmail.mockResolvedValueOnce({ error: {}, data: null })

    const { result } = renderHook(() => useAuth())

    let outcome
    await act(async () => {
      outcome = await result.current.signInWithEmail({ email: 'x@y.z', password: 'p' })
    })

    expect(outcome).toEqual({ ok: false, message: 'Sign-in failed.' })
  })
})

describe('useAuth — registration with email verification', () => {
  it('reports verificationRequired when sign-up does not establish a session', async () => {
    // With requireEmailVerification enabled, better-auth returns { token: null, user }.
    signUpEmail.mockResolvedValueOnce({ error: null, data: { token: null, user: { id: 'usr_2' } } })

    const { result } = renderHook(() => useAuth())

    let outcome: { ok: boolean; message?: string; verificationRequired?: boolean } | undefined
    await act(async () => {
      outcome = await result.current.signUpWithEmail({ name: 'New', email: 'new@obiter.dev', password: 'password123' })
    })

    expect(outcome).toMatchObject({ ok: true, verificationRequired: true })
    expect(outcome?.message).toMatch(/verify/i)
  })

  it('reports a sign-up failure', async () => {
    signUpEmail.mockResolvedValueOnce({ error: { message: 'Email already in use.' }, data: null })

    const { result } = renderHook(() => useAuth())

    let outcome
    await act(async () => {
      outcome = await result.current.signUpWithEmail({ name: 'Dup', email: 'lex@obiter.dev', password: 'password123' })
    })

    expect(outcome).toEqual({ ok: false, message: 'Email already in use.' })
  })
})

describe('useAuth — session presence', () => {
  it('exposes the real session when better-auth reports one', async () => {
    useSession.mockReturnValue({
      data: { user: { id: 'usr_1' }, session: { id: 'ses_1' } },
      isPending: false,
    })

    const { result } = renderHook(() => useAuth())

    await waitFor(() => {
      expect(result.current.session).not.toBeNull()
    })
    expect(result.current.session?.user.id).toBe('usr_1')
    expect(result.current.isPending).toBe(false)
  })

  it('reports null session when unauthenticated', () => {
    useSession.mockReturnValue({ data: null, isPending: false })
    const { result } = renderHook(() => useAuth())
    expect(result.current.session).toBeNull()
  })
})
