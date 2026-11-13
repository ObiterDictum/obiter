import { createAuthClient } from 'better-auth/react'
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins'
import { useQueryClient } from '@tanstack/react-query'
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@obiter/contracts/limits'
import {
  clearStoredDocumentDraftsForUser,
  suspendDocumentDraftWrites,
} from './document-draft-identity'
import { resolvePackagedApiOrigin } from './lib/api-url'
import {
  clearDesktopAuthToken,
  getDesktopAuthToken,
  loadDesktopAuthToken,
  setDesktopAuthToken,
} from './lib/auth-token'
import { readDesktopBridge } from './lib/desktop-bridge'

function authBaseURL(): string {
  if (typeof window !== 'undefined') {
    return resolvePackagedApiOrigin() ?? window.location.origin
  }
  return (
    process.env.OBITER_API_ORIGIN ??
    process.env.BETTER_AUTH_URL ??
    'http://localhost:8787'
  )
}

const desktopAuthFetchOptions = readDesktopBridge()
  ? {
      auth: {
        type: 'Bearer' as const,
        token: async () => (await getDesktopAuthToken()) ?? undefined,
      },
      onSuccess: async (context: { response: Response }) => {
        const token = context.response.headers.get('set-auth-token')
        if (token) {
          await setDesktopAuthToken(token)
        }
      },
    }
  : undefined

if (desktopAuthFetchOptions) {
  void loadDesktopAuthToken()
}

export const authClient = createAuthClient({
  baseURL: authBaseURL(),
  plugins: [magicLinkClient(), twoFactorClient()],
  fetchOptions: desktopAuthFetchOptions,
})

export interface SignInEmailInput {
  email: string
  password: string
}

export interface SignUpEmailInput {
  name: string
  email: string
  password: string
  callbackURL: string
}

export interface SignInResult {
  ok: boolean
  twoFactor?: boolean
  message?: string
  code?: string
}

export interface UseAuthReturn {
  session: AuthSessionPresence | null
  isPending: boolean
  signInWithEmail: (input: SignInEmailInput) => Promise<SignInResult>
  verifyTwoFactorSignIn: (input: {
    code: string
    backupCode?: boolean
    trustDevice?: boolean
  }) => Promise<SignInResult>
  signUpWithEmail: (input: SignUpEmailInput) => Promise<{
    ok: boolean
    message?: string
    verificationRequired?: boolean
  }>
  requestMagicLink: (
    email: string,
    callbackURL?: string,
  ) => Promise<{ ok: boolean; message?: string }>
  requestPasswordReset: (
    email: string,
  ) => Promise<{ ok: boolean; message?: string }>
  resetPassword: (
    token: string,
    newPassword: string,
  ) => Promise<{ ok: boolean; message?: string; code?: string }>
  changePassword: (input: {
    currentPassword: string
    newPassword: string
  }) => Promise<{ ok: boolean; message?: string; code?: string }>
  resendVerificationEmail: (
    email: string,
    callbackURL?: string,
  ) => Promise<{ ok: boolean; message?: string }>
  signOut: () => Promise<void>
}

interface AuthSessionPresence {
  user: { id: string; email?: string }
  session: { id: string }
}

function changePasswordMessage(code: string | undefined): string {
  switch (code) {
    case 'INVALID_PASSWORD':
      return 'Your current password is incorrect.'
    case 'PASSWORD_TOO_SHORT':
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    case 'PASSWORD_TOO_LONG':
      return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return 'This account does not sign in with a password.'
    default:
      return 'Could not change your password. Try again.'
  }
}

function twoFactorSignInMessage(code: string | undefined): string {
  switch (code) {
    case 'INVALID_CODE':
      return 'That code is not correct. Check it and try again.'
    case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
      return 'Too many incorrect attempts. Start sign-in again.'
    case 'ACCOUNT_TEMPORARILY_LOCKED':
      return 'Too many incorrect attempts. Try again later.'
    case 'INVALID_TWO_FACTOR_COOKIE':
      return 'Your sign-in timed out. Start again.'
    default:
      return 'Could not verify your second factor. Try again.'
  }
}

export function useAuth(): UseAuthReturn {
  const realSession = authClient.useSession()
  const queryClient = useQueryClient()

  async function refreshSessionAfterAuth() {
    try {
      await realSession.refetch()
    } catch {}
  }

  async function signInWithEmail(input: SignInEmailInput) {
    const result = await authClient.signIn.email(input)
    if (result.error) {
      return {
        ok: false,
        message: result.error.message ?? 'Sign-in failed.',
        code:
          typeof result.error.code === 'string' ? result.error.code : undefined,
      }
    }
    const data: unknown = result.data
    if (
      data !== null &&
      typeof data === 'object' &&
      'twoFactorRedirect' in data &&
      data.twoFactorRedirect === true
    ) {
      return { ok: true, twoFactor: true }
    }
    await refreshSessionAfterAuth()
    return { ok: true }
  }

  async function verifyTwoFactorSignIn(input: {
    code: string
    backupCode?: boolean
    trustDevice?: boolean
  }) {
    const trustDevice = input.trustDevice === true ? { trustDevice: true } : {}
    const result = input.backupCode
      ? await authClient.twoFactor.verifyBackupCode({
          code: input.code,
          ...trustDevice,
        })
      : await authClient.twoFactor.verifyTotp({
          code: input.code,
          ...trustDevice,
        })
    if (result.error) {
      const code =
        typeof result.error.code === 'string' ? result.error.code : undefined
      return {
        ok: false,
        message: twoFactorSignInMessage(code),
        code,
      }
    }
    await refreshSessionAfterAuth()
    return { ok: true }
  }

  async function signUpWithEmail(input: SignUpEmailInput) {
    const result = await authClient.signUp.email(input)
    if (result.error) {
      return { ok: false, message: result.error.message ?? 'Sign-up failed.' }
    }
    if (!result.data?.token) {
      return { ok: true, verificationRequired: true }
    }
    await refreshSessionAfterAuth()
    return { ok: true }
  }

  async function resendVerificationEmail(email: string, callbackURL?: string) {
    const result = await authClient.sendVerificationEmail({
      email,
      ...(callbackURL ? { callbackURL } : {}),
    })
    if (result.error) {
      return {
        ok: false,
        message: result.error.message ?? 'Could not send a verification email.',
      }
    }
    return {
      ok: true,
      message: 'Check your email for a verification link.',
    }
  }

  async function requestMagicLink(email: string, callbackURL?: string) {
    const resolvedCallbackURL =
      callbackURL ??
      (typeof window === 'undefined' ? undefined : `${window.location.origin}/`)
    const result = await authClient.signIn.magicLink({
      email,
      callbackURL: resolvedCallbackURL,
    })
    if (result.error) {
      return {
        ok: false,
        message: result.error.message ?? 'Could not send magic link.',
      }
    }
    return { ok: true, message: 'Check your email for a sign-in link.' }
  }

  async function signOut() {
    const userId = realSession.data?.user?.id
    const result = await authClient.signOut()
    if (result.error) {
      throw new Error(result.error.message ?? 'Could not sign out.')
    }
    try {
      await clearDesktopAuthToken()
    } finally {
      suspendDocumentDraftWrites()
      if (userId) clearStoredDocumentDraftsForUser(userId)
      queryClient.clear()
    }
  }

  async function changePassword(input: {
    currentPassword: string
    newPassword: string
  }) {
    const result = await authClient.changePassword({
      ...input,
      revokeOtherSessions: true,
    })
    if (result.error) {
      return {
        ok: false,
        code:
          typeof result.error.code === 'string' ? result.error.code : undefined,
        message: changePasswordMessage(
          typeof result.error.code === 'string' ? result.error.code : undefined,
        ),
      }
    }
    await refreshSessionAfterAuth()
    return { ok: true }
  }

  async function requestPasswordReset(email: string) {
    const result = await authClient.requestPasswordReset({ email })
    if (result.error) {
      return {
        ok: false,
        message: result.error.message ?? 'Could not send a reset link.',
      }
    }
    return {
      ok: true,
      message:
        'If an account exists for that email, we have sent a link to reset your password.',
    }
  }

  async function resetPassword(token: string, newPassword: string) {
    const result = await authClient.resetPassword({ token, newPassword })
    if (result.error) {
      return {
        ok: false,
        message: result.error.message ?? 'Could not reset your password.',
        code:
          typeof result.error.code === 'string' ? result.error.code : undefined,
      }
    }
    return { ok: true }
  }

  return {
    session: realSession.data,
    isPending: realSession.isPending,
    signInWithEmail,
    verifyTwoFactorSignIn,
    signUpWithEmail,
    requestMagicLink,
    requestPasswordReset,
    resetPassword,
    changePassword,
    resendVerificationEmail,
    signOut,
  }
}
