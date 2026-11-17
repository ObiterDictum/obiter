import '@obiter/test-dom'
import { spyOn } from 'bun:test'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider, Toaster } from '@obiter/ui'
import {
  staffBuzzAgents,
  type StaffBuzzAgent,
  type StaffBuzzMember,
  type StaffBuzzResponse,
} from '@obiter/contracts'
import { StaffBuzzRouteView } from './staff-buzz'

export const NPUB =
  'npub1gutgpl9302edr9ch7mg90z5fxk962mgkdx7xxcyu57fr5a7j0ydqvucky8'

export interface BuzzRequest {
  method: string
  path: string
  body: unknown
}

export interface BuzzServer {
  view: StaffBuzzResponse
  requests: BuzzRequest[]
  inviteStatus?: number
  keyError?: { status: number; message: string }
  rolesError?: { status: number; message: string }
}

export function buzzMember(
  overrides: Partial<StaffBuzzMember> = {},
): StaffBuzzMember {
  return {
    userId: 'u_me',
    name: 'Karl Staff',
    email: 'karl@synthetic.test',
    npub: null,
    status: 'unlinked',
    roles: [],
    ...overrides,
  }
}

export function buzzView({
  available = true,
  canManage = false,
  me = {},
  members = [],
}: {
  available?: boolean
  canManage?: boolean
  me?: Partial<StaffBuzzMember> & { agents?: StaffBuzzAgent[] }
  members?: StaffBuzzMember[]
} = {}): StaffBuzzResponse {
  const { agents = staffBuzzAgents([]), ...memberFields } = me
  return {
    available,
    canManage,
    me: { ...buzzMember(memberFields), agents },
    members,
  }
}

function apiError(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message, requestId: 'req_test' } },
    { status },
  )
}

export function renderBuzz(initial: StaffBuzzResponse) {
  const server: BuzzServer = { view: initial, requests: [] }
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const path = String(input)
        const method = init?.method ?? 'GET'
        const body = init?.body
          ? (JSON.parse(String(init.body)) as unknown)
          : null
        server.requests.push({ method, path, body })
        if (path.endsWith('/api/staff/buzz/invite')) {
          if (server.inviteStatus) {
            return apiError(
              server.inviteStatus,
              'buzz_unavailable',
              'Buzz is unavailable.',
            )
          }
          return Response.json({
            url: 'https://buzz.example/invite/synthetic',
            expiresAt: '2026-11-20T09:00:00.000Z',
          })
        }
        if (path.endsWith('/api/staff/buzz/key')) {
          if (server.keyError) {
            return apiError(
              server.keyError.status,
              'validation_failed',
              server.keyError.message,
            )
          }
          server.view =
            method === 'DELETE'
              ? {
                  ...server.view,
                  me: { ...buzzMember(), agents: staffBuzzAgents([]) },
                }
              : {
                  ...server.view,
                  me: {
                    ...server.view.me,
                    npub: (body as { npub: string }).npub,
                    status: 'not_member',
                  },
                }
          return Response.json(server.view)
        }
        if (path.includes('/roles')) {
          if (server.rolesError) {
            return apiError(
              server.rolesError.status,
              'validation_failed',
              server.rolesError.message,
            )
          }
          const userId = path.split('/members/')[1]?.split('/')[0]
          const roles = (body as { roles: StaffBuzzMember['roles'] }).roles
          server.view = {
            ...server.view,
            members: server.view.members.map((member) =>
              member.userId === userId ? { ...member, roles } : member,
            ),
          }
          return Response.json(server.view)
        }
        return Response.json(server.view)
      },
      { preconnect: fetch.preconnect },
    ),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['current-user'], {
    isStaff: true,
    twoFactorEnabled: true,
    user: {
      id: 'u_me',
      name: 'Karl Staff',
      email: 'karl@synthetic.test',
      role: 'staff',
    },
    organisation: null,
  })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Toaster />
        <StaffBuzzRouteView />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { server, client }
}
