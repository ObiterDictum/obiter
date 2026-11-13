import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MeResponse } from '@obiter/contracts'

const mocks = vi.hoisted(() => ({
  useCurrentUser: vi.fn(),
  enableTwoFactor: vi.fn(),
  confirmTwoFactorEnrolment: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateTwoFactorBackupCodes: vi.fn(),
  twoFactorQrDataUrl: vi.fn(),
}))

mock.module('../current-user', () => ({
  useCurrentUser: mocks.useCurrentUser,
}))

mock.module('../two-factor', () => ({
  enableTwoFactor: mocks.enableTwoFactor,
  confirmTwoFactorEnrolment: mocks.confirmTwoFactorEnrolment,
  disableTwoFactor: mocks.disableTwoFactor,
  regenerateTwoFactorBackupCodes: mocks.regenerateTwoFactorBackupCodes,
  twoFactorQrDataUrl: mocks.twoFactorQrDataUrl,
}))

const { TwoFactorSection } = await import('./settings-two-factor')

const ME_OFF: MeResponse = {
  isStaff: false,
  twoFactorEnabled: false,
  user: { id: 'usr_1', email: 'lex@obiter.dev', name: 'Lex', role: 'owner' },
  organisation: { id: 'org_1', name: 'Obiter', plan: 'private_beta' },
}

const ME_ON: MeResponse = {
  ...ME_OFF,
  twoFactorEnabled: true,
  twoFactorEnabledAt: '2026-01-02T03:04:05.000Z',
}

const SETUP = {
  totpURI:
    'otpauth://totp/Obiter%3Alex%40obiter.dev?secret=ABCDEF&issuer=Obiter',
  backupCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'],
}

function renderSection(me: MeResponse = ME_OFF) {
  mocks.useCurrentUser.mockReturnValue({ data: me })
  const client = new QueryClient()
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<TwoFactorSection />, { wrapper: Wrapper })
}

async function submitPasswordStep(password: string) {
  fireEvent.change(screen.getByLabelText('Confirm your password'), {
    target: { value: password },
  })
  const buttons = screen.getAllByRole('button')
  const submit = buttons.find((button) =>
    /Continue|Regenerate codes|Turn off two-factor/.test(
      button.textContent ?? '',
    ),
  )
  if (!submit) throw new Error('password step submit not found')
  await act(async () => {
    fireEvent.click(submit)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.twoFactorQrDataUrl.mockResolvedValue('data:image/png;base64,qr')
})

afterEach(() => {
  cleanup()
})

describe('TwoFactorSection — off state', () => {
  it('offers setup and asks for the password before enabling', async () => {
    renderSection()

    expect(screen.getByText(/Two-factor authentication is off/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }))

    expect(screen.getByLabelText('Confirm your password')).toBeTruthy()
    expect(mocks.enableTwoFactor).not.toHaveBeenCalled()
  })

  it('shows the QR code, manual key and backup codes through enrolment', async () => {
    mocks.enableTwoFactor.mockResolvedValueOnce({ ok: true, data: SETUP })
    mocks.confirmTwoFactorEnrolment.mockResolvedValueOnce({
      ok: true,
      data: null,
    })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Set up' }))
    await submitPasswordStep('correct-password')

    await waitFor(() => {
      expect(mocks.enableTwoFactor).toHaveBeenCalledWith('correct-password')
    })
    expect(
      await screen.findByAltText('QR code for your authenticator app'),
    ).toBeTruthy()
    expect(screen.getByText('ABCDEF')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Authentication code'), {
      target: { value: '123456' },
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirm and turn on' }),
      )
    })

    await waitFor(() => {
      expect(mocks.confirmTwoFactorEnrolment).toHaveBeenCalledWith('123456')
    })
    expect(await screen.findByText('aaaaa-bbbbb')).toBeTruthy()
    expect(screen.getByText('ccccc-ddddd')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download (.txt)' })).toBeTruthy()
  })

  it('surfaces an incorrect password without leaving setup', async () => {
    mocks.enableTwoFactor.mockResolvedValueOnce({
      ok: false,
      message: 'Your password is incorrect.',
    })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: 'Set up' }))
    await submitPasswordStep('wrong-password')

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Your password is incorrect.',
    )
    expect(
      screen.queryByAltText('QR code for your authenticator app'),
    ).toBeNull()
  })
})

describe('TwoFactorSection — enabled state', () => {
  it('shows the enabled status and offers regenerate and turn off', () => {
    renderSection(ME_ON)

    expect(screen.getByText(/Two-factor authentication is on/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Regenerate backup codes' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy()
  })

  it('requires the password before regenerating backup codes', async () => {
    mocks.regenerateTwoFactorBackupCodes.mockResolvedValueOnce({
      ok: true,
      data: { status: true, backupCodes: ['zzzzz-yyyyy'] },
    })
    renderSection(ME_ON)

    fireEvent.click(
      screen.getByRole('button', { name: 'Regenerate backup codes' }),
    )
    expect(mocks.regenerateTwoFactorBackupCodes).not.toHaveBeenCalled()

    await submitPasswordStep('correct-password')

    await waitFor(() => {
      expect(mocks.regenerateTwoFactorBackupCodes).toHaveBeenCalledWith(
        'correct-password',
      )
    })
    expect(await screen.findByText('zzzzz-yyyyy')).toBeTruthy()
  })

  it('requires the password before turning two-factor off', async () => {
    mocks.disableTwoFactor.mockResolvedValueOnce({ ok: true, data: null })
    renderSection(ME_ON)

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(mocks.disableTwoFactor).not.toHaveBeenCalled()

    await submitPasswordStep('correct-password')

    await waitFor(() => {
      expect(mocks.disableTwoFactor).toHaveBeenCalledWith('correct-password')
    })
    expect(
      await screen.findByText(/Two-factor authentication is off/),
    ).toBeTruthy()
  })
})
