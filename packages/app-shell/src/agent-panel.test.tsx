import '@obiter/test-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import type { AgentRun, AgentRunDetailResponse } from '@obiter/contracts'
import { AgentTab } from './agent-panel'

const baseRun = {
  id: 'arun_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  createdBy: 'usr_1',
  goal: 'Is a clause excluding liability for negligence enforceable?',
  context: { documentId: null, versionId: null },
  matterText: { allowed: false, sent: false },
  toolAllowList: ['search_corpus', 'get_paragraph'],
  versions: {
    agent: 'agent-1',
    prompt: 'prompt-1',
    toolRegistry: 'tools-1',
    trace: 'trace-v1',
    rateCard: 'rates-1',
    model: { provider: 'anthropic', modelId: 'm', snapshot: 'm-1' },
  },
  budget: {
    currency: 'USD',
    tokenCap: 1000,
    costCapMicros: 1000,
    tokensReserved: 0,
    tokensUsed: 10,
    costReservedMicros: 0,
    costUsedMicros: 10,
  },
  stepCount: 2,
  sourcesRead: 1,
  createdAt: '2026-11-03T10:00:00.000Z',
  startedAt: '2026-11-03T10:00:00.000Z',
  finishedAt: '2026-11-03T10:00:12.000Z',
} as const

const completed: AgentRun = {
  ...baseRun,
  toolAllowList: [...baseRun.toolAllowList],
  status: 'completed',
  stopReason: 'completed',
  answer: {
    sentences: [
      {
        text: 'A term excluding liability for negligence causing death is void.',
        evidenceIds: ['uksc-2024-1:judgment_paragraph:14'],
      },
    ],
    evidence: [
      {
        kind: 'corpus_paragraph',
        evidenceId: 'uksc-2024-1:judgment_paragraph:14',
        authorityId: 'uksc-2024-1',
        title: 'Able v Baker',
        neutralCitation: '[2024] UKSC 1',
        paragraphNumber: 14,
      },
    ],
    droppedSentenceCount: 1,
  },
}

const refused: AgentRun = {
  ...baseRun,
  toolAllowList: [...baseRun.toolAllowList],
  status: 'refused',
  stopReason: 'policy_blocked',
  refusal: {
    code: 'policy_blocked',
    ruleId: 'matter-text-not-permitted',
    message:
      'Your organisation does not send matter documents to the model provider.',
    missing: {
      kind: 'setting',
      id: 'agent.matterTextToModel',
      label: 'Send matter documents to the model provider',
    },
  },
}

const running: AgentRun = {
  ...baseRun,
  toolAllowList: [...baseRun.toolAllowList],
  finishedAt: null,
  status: 'running',
  stopReason: null,
}

let runs: AgentRun[] = []
const requests: Array<{ url: string; method: string }> = []

function detail(run: AgentRun): AgentRunDetailResponse {
  return { run, steps: [], toolCalls: [], events: [] }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  requests.length = 0
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        requests.push({ url, method })
        if (url.endsWith('/api/me')) {
          return json({
            user: {
              id: 'usr_1',
              email: 'a@example.test',
              name: 'A',
              role: 'member',
            },
            organisation: { id: 'org_1', name: 'Org', plan: 'private_beta' },
          })
        }
        if (url.endsWith('/agent-settings')) {
          return json({
            matterTextToModel: false,
            model: null,
            keyLastFour: null,
            keySetAt: null,
          })
        }
        if (url.includes('/api/agent-sessions')) return json({ sessions: [] })
        if (url.endsWith('/api/matters/mtr_1/agent-runs')) return json({ runs })
        if (url.endsWith('/cancel')) {
          return json({
            run: {
              ...running,
              status: 'cancelled',
              stopReason: 'user_cancelled',
            },
          })
        }
        if (url.includes('/events')) {
          return new Response(new ReadableStream({ start() {} }), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        const run = runs.find((item) =>
          url.endsWith(`/api/agent-runs/${item.id}`),
        )
        if (run) return json(detail(run))
        if (url.includes('/api/matters/mtr_1')) {
          return json(
            {
              error: {
                code: 'matter_not_found',
                message: 'Matter not found.',
                requestId: 'r',
              },
            },
            404,
          )
        }
        return json(
          {
            error: {
              code: 'document_not_found',
              message: 'Not found.',
              requestId: 'r',
            },
          },
          404,
        )
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
})

afterEach(() => {
  cleanup()
  mock.restore()
})

function renderTab(path = '/matters/mtr_1') {
  const rootRoute = createRootRoute()
  const page = () => <AgentTab />
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/matters/$matterId',
        component: page,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: page,
      }),
      createRoute({ getParentRoute: () => rootRoute, path: '/cases/$caseId' }),
      createRoute({ getParentRoute: () => rootRoute, path: '/settings' }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('agent tab', () => {
  it('renders no agent panel content outside matters', async () => {
    renderTab('/')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('links a refusal for a missing setting to the Agent settings', async () => {
    runs = [refused]
    renderTab()
    fireEvent.click(await screen.findByText(refused.goal))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'Send matter documents to the model provider',
    )
    expect(
      screen.getByRole('link', { name: 'Settings' }).getAttribute('href'),
    ).toBe('/settings?section=agent')
  })

  it('tells the user when the organisation has no agent model set', async () => {
    renderTab()
    expect(
      await screen.findByText(/No agent model is set for this organisation/),
    ).toBeTruthy()
  })

  it('links every answer pointer to the paragraph it cites', async () => {
    runs = [completed]
    renderTab()
    fireEvent.click(await screen.findByText(completed.goal))
    const pointers = await screen.findAllByRole('link', {
      name: 'Open Able v Baker [2024] UKSC 1, para 14',
    })
    expect(pointers.length).toBe(2)
    expect(pointers[0]?.getAttribute('href')).toBe('/cases/uksc-2024-1#para-14')
    expect(screen.getByText('Worked for 12s · read 1 source')).toBeTruthy()
    expect(screen.getByText(/One sentence was left out/)).toBeTruthy()
  })

  it('cancels a live run through the API', async () => {
    runs = [running]
    renderTab()
    fireEvent.click(await screen.findByText(running.goal))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))
    expect(await screen.findByText('You cancelled this run.')).toBeTruthy()
    expect(requests).toContainEqual({
      url: '/api/agent-runs/arun_1/cancel',
      method: 'POST',
    })
  })

  it('offers a Message composer for a new matter conversation', async () => {
    runs = []
    renderTab()
    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled'),
    ).toBe(true)
  })
})
