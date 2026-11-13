import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@obiter/ui'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api'
import { useAuth } from '../auth'
import { formatDate, formatDateTime } from '../format'
import { ErrorNotice, SectionHeading } from './settings-fields'

interface AuthSession {
  id: string
  token: string
  userAgent: string | null
  createdAt: string
  updatedAt: string
}

const sessionsKey = ['auth-sessions'] as const

function useAuthSessions(enabled: boolean) {
  return useQuery({
    queryKey: sessionsKey,
    enabled,
    queryFn: () => apiFetch<AuthSession[]>('/api/auth/list-sessions'),
  })
}

function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch('/api/auth/revoke-session', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  })
}

function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch('/api/auth/revoke-other-sessions', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  })
}

function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  const browser = /Electron|Obiter/.test(userAgent)
    ? 'Obiter'
    : /Edg\//.test(userAgent)
      ? 'Edge'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent) || /Chromium\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser'
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'an unknown system'
  if (browser === 'Obiter') return 'Obiter desktop app'
  return `${browser} on ${system}`
}

export function SignedInDevices({ active }: { active: boolean }) {
  const { session } = useAuth()
  const sessions = useAuthSessions(active)
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentId = session?.session.id
  const others = (sessions.data ?? []).filter((item) => item.id !== currentId)

  async function signOut(token: string) {
    setError(null)
    try {
      await revoke.mutateAsync(token)
    } catch {
      setError('Could not sign out that device. Try again.')
    }
  }

  async function signOutOthers() {
    setError(null)
    try {
      await revokeOthers.mutateAsync()
      setConfirming(false)
    } catch {
      setError('Could not sign out the other devices. Try again.')
    }
  }

  return (
    <section
      aria-label="Signed-in devices"
      className="flex flex-col gap-6 border-t border-line pt-8"
    >
      <SectionHeading
        id="settings-devices-heading"
        level="h3"
        title="Signed-in devices"
        description="Every browser and app signed in to your account."
      />
      {sessions.isPending ? (
        <Skeleton className="h-24" />
      ) : sessions.isError ? (
        <ErrorNotice message="Could not load your signed-in devices." />
      ) : sessions.data && sessions.data.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <Table className="min-w-[32rem]">
              <THead>
                <TR>
                  <TH>Device</TH>
                  <TH>Signed in</TH>
                  <TH>Last used</TH>
                  <TH align="end"> </TH>
                </TR>
              </THead>
              <TBody>
                {sessions.data.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <span className="flex items-center gap-2">
                        <span className="truncate text-item text-ink">
                          {describeUserAgent(item.userAgent)}
                        </span>
                        {item.id === currentId ? (
                          <Badge tone="brand">This device</Badge>
                        ) : null}
                      </span>
                    </TD>
                    <TD className="text-muted">{formatDate(item.createdAt)}</TD>
                    <TD className="text-muted">
                      {formatDateTime(item.updatedAt)}
                    </TD>
                    <TD className="text-end">
                      {item.id === currentId ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={
                            revoke.isPending && revoke.variables === item.token
                          }
                          onClick={() => void signOut(item.token)}
                        >
                          Sign out
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {error ? <ErrorNotice message={error} /> : null}
          {others.length > 0 ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirming(true)}
              >
                Sign out of all other devices
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-meta text-muted">No signed-in devices to show.</p>
      )}
      {confirming ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !revokeOthers.isPending) setConfirming(false)
          }}
        >
          <DialogContent size="sm">
            <DialogTitle>Sign out of all other devices</DialogTitle>
            <DialogDescription>
              Every other browser and app will be signed out of your account.
              This device stays signed in.
            </DialogDescription>
            {error ? <ErrorNotice message={error} /> : null}
            <DialogFooter>
              <DialogClose
                render={
                  <Button variant="secondary" disabled={revokeOthers.isPending}>
                    Cancel
                  </Button>
                }
              />
              <Button
                variant="danger"
                loading={revokeOthers.isPending}
                onClick={() => void signOutOthers()}
              >
                Sign out other devices
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}
