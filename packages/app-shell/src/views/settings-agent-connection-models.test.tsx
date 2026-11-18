import '@obiter/test-dom'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ConnectionModels } from './settings-agent-connection-models'

const bodies: unknown[] = []
let latest: string[] | null = null
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function serve(listing: () => Response, probe = () => json({ message: 'ok' })) {
  bodies.length = 0
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const body: unknown = JSON.parse(String(init?.body))
        bodies.push(body)
        return typeof body === 'object' && body !== null && 'modelId' in body
          ? probe()
          : listing()
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
}
function Harness({ initial }: { initial: string[] | null }) {
  const [enabled, setEnabled] = useState(initial)
  latest = enabled
  return (
    <ConnectionModels
      connectionId="c1"
      enabled={enabled}
      setEnabled={setEnabled}
    />
  )
}
function show(initial: string[] | null = null) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Harness initial={initial} />
    </QueryClientProvider>,
  )
}
afterEach(() => {
  cleanup()
  mock.restore()
})

describe('connection model checklist', () => {
  it('lists provider models by name and toggles the enabled set', async () => {
    serve(() =>
      json({
        message: 'ok',
        truncated: true,
        models: [
          { id: 'glm-5.3', name: 'GLM-5.3' },
          { id: 'raw-model', name: null },
        ],
      }),
    )
    show(['glm-5.3'])
    const glm = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: 'GLM-5.3 (glm-5.3)',
    })
    expect(glm.checked).toBe(true)
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'raw-model' })
        .checked,
    ).toBe(false)
    expect(screen.getByText(/1 of 2 turned on/).textContent).toContain(
      'only the first 500 are shown',
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'raw-model' }))
    fireEvent.click(glm)
    expect(latest).toEqual(['raw-model'])
    expect(screen.queryByLabelText('Model ID')).toBeNull()
  })
  it('treats an untouched connection as every listed model turned on', async () => {
    serve(() =>
      json({
        message: 'ok',
        models: [
          { id: 'a', name: null },
          { id: 'b', name: null },
        ],
      }),
    )
    show()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'b' }))
    expect(latest).toEqual(['a'])
  })
  it('falls back to a tested manual id when the provider lists nothing', async () => {
    serve(
      () =>
        json(
          {
            error: {
              code: 'agent_provider_unreachable',
              message: 'This provider does not list its models.',
              requestId: 'r',
            },
          },
          422,
        ),
      () =>
        json(
          {
            error: {
              code: 'agent_provider_unreachable',
              message: 'The provider rejected the request: Model not found',
              requestId: 'r',
            },
          },
          422,
        ),
    )
    show()
    expect(
      await screen.findByText('This provider does not list its models.'),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Model ID'), {
      target: { value: 'GLM-5.3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test and add' }))
    expect(
      await screen.findByText(
        'The provider rejected the request: Model not found',
      ),
    ).toBeTruthy()
    expect(bodies.at(-1)).toEqual({ modelId: 'GLM-5.3' })
    expect(latest).toBeNull()
  })
  it('works against an API that only reports a model count', async () => {
    serve(() =>
      json({ message: 'Connected successfully. 3 models available.' }),
    )
    show()
    fireEvent.change(await screen.findByLabelText('Model ID'), {
      target: { value: 'glm-5.3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Test and add' }))
    expect(
      (
        await screen.findByRole<HTMLInputElement>('checkbox', {
          name: 'glm-5.3',
        })
      ).checked,
    ).toBe(true)
    expect(latest).toEqual(['glm-5.3'])
  })
})
