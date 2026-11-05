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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { OrganisationAgentSettings, UserRole } from '@obiter/contracts'
import { OrganisationAgentSettingsSection } from './settings-agent'

const EMPTY: OrganisationAgentSettings = {
  matterTextToModel: false,
  model: null,
  keyLastFour: null,
  keySetAt: null,
}

const STORED: OrganisationAgentSettings = {
  matterTextToModel: true,
  model: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    snapshot: 'claude-sonnet-4-5-20250929',
  },
  keyLastFour: 'x9Qa',
  keySetAt: '2026-11-04T09:30:00.000Z',
}

let current: OrganisationAgentSettings = EMPTY
let putResponse: (body: unknown) => Response
const puts: unknown[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  puts.length = 0
  current = EMPTY
  putResponse = () => json(current)
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        if (!String(input).endsWith('/api/organisations/org_1/agent-settings'))
          return json(
            { error: { code: 'not_found', message: 'No.', requestId: 'r' } },
            404,
          )
        if (init?.method === 'PUT') {
          const body: unknown = JSON.parse(String(init.body))
          puts.push(body)
          return putResponse(body)
        }
        return json(current)
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
})

afterEach(() => {
  cleanup()
  mock.restore()
})

function renderSection(role: UserRole) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <OrganisationAgentSettingsSection organisationId="org_1" role={role} />
    </QueryClientProvider>,
  )
  return screen.findByRole('region', { name: 'Agent' })
}

describe('settings agent model, empty', () => {
  it('an owner with nothing configured is asked for a model and a key', async () => {
    const section = await renderSection('owner')
    expect(await within(section).findByLabelText('Model')).toBeTruthy()
    expect(within(section).getByLabelText('API key').getAttribute('type')).toBe(
      'password',
    )
    expect(within(section).queryByText(/Key ending/)).toBeNull()
    expect(
      within(section).getByText(
        /Runs are refused until a model and key are set/,
      ),
    ).toBeTruthy()
  })

  it('saving sends the provider, the trimmed model and the pasted key', async () => {
    const section = await renderSection('owner')
    fireEvent.change(await within(section).findByLabelText('Model'), {
      target: { value: ' claude-sonnet-4-5 ' },
    })
    fireEvent.change(within(section).getByLabelText('API key'), {
      target: { value: 'sk-ant-api03-abcdefghijklmnop' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Save model' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({
      model: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        snapshot: null,
      },
      key: { action: 'replace', value: 'sk-ant-api03-abcdefghijklmnop' },
    })
  })

  it('a model id in the wrong format is caught before it is sent', async () => {
    const section = await renderSection('admin')
    fireEvent.change(await within(section).findByLabelText('Model'), {
      target: { value: 'gpt-5' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Save model' }))
    expect(
      await within(section).findByText(
        'Anthropic model ids look like claude-sonnet-4-5.',
      ),
    ).toBeTruthy()
    expect(puts).toHaveLength(0)
  })
})

describe('settings agent model, stored key', () => {
  beforeEach(() => {
    current = STORED
  })

  it('shows only the last four characters and the date the key was set', async () => {
    const section = await renderSection('owner')
    expect(
      await within(section).findByText('Key ending x9Qa, set 4 Nov 2026'),
    ).toBeTruthy()
    expect(within(section).queryByLabelText('API key')).toBeNull()
  })

  it('Replace opens an empty password field for the new key', async () => {
    const section = await renderSection('owner')
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Replace key' }),
    )
    const field = within(section).getByLabelText('New API key')
    expect(field.getAttribute('type')).toBe('password')
    expect((field as HTMLInputElement).value).toBe('')
  })

  it('saving the model without a new key leaves the stored key alone', async () => {
    const section = await renderSection('owner')
    fireEvent.change(await within(section).findByLabelText('Model'), {
      target: { value: 'claude-opus-4-1' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Save model' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0]).toEqual({
      model: {
        provider: 'anthropic',
        modelId: 'claude-opus-4-1',
        snapshot: 'claude-sonnet-4-5-20250929',
      },
    })
  })

  it('Remove clears the stored key', async () => {
    putResponse = () => json({ ...STORED, keyLastFour: null, keySetAt: null })
    const section = await renderSection('owner')
    fireEvent.click(
      await within(section).findByRole('button', { name: 'Remove key' }),
    )
    await waitFor(() => expect(puts).toEqual([{ key: { action: 'remove' } }]))
    expect(await within(section).findByLabelText('API key')).toBeTruthy()
  })
})

describe('settings agent model, member', () => {
  it('a member sees the provider and model read-only and cannot change them', async () => {
    current = { ...STORED, keyLastFour: null, keySetAt: null }
    const section = await renderSection('member')
    expect(await within(section).findByText('Anthropic')).toBeTruthy()
    expect(within(section).getByText('claude-sonnet-4-5')).toBeTruthy()
    expect(within(section).queryByRole('textbox')).toBeNull()
    expect(within(section).queryByRole('button')).toBeNull()
    expect(within(section).queryByText(/Key ending/)).toBeNull()
    expect(
      within(section).getAllByText('Only an owner or admin can change this.'),
    ).not.toHaveLength(0)
  })

  it('a member of an organisation with no model is told runs are refused', async () => {
    const section = await renderSection('member')
    expect(
      await within(section).findByText(
        'No model is set for this organisation.',
      ),
    ).toBeTruthy()
  })
})

describe('settings agent model, save error', () => {
  it('a key the provider rejects shows the server message and keeps the form', async () => {
    putResponse = () =>
      json(
        {
          error: {
            code: 'agent_key_rejected',
            message: 'Anthropic rejected this key.',
            requestId: 'r',
          },
        },
        422,
      )
    const section = await renderSection('owner')
    fireEvent.change(await within(section).findByLabelText('Model'), {
      target: { value: 'claude-sonnet-4-5' },
    })
    fireEvent.change(within(section).getByLabelText('API key'), {
      target: { value: 'sk-ant-api03-abcdefghijklmnop' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Save model' }))
    expect((await within(section).findByRole('alert')).textContent).toBe(
      'Anthropic rejected this key.',
    )
    expect(
      (within(section).getByLabelText('API key') as HTMLInputElement).value,
    ).toBe('sk-ant-api03-abcdefghijklmnop')
  })

  it('keeps the matter documents switch for an owner', async () => {
    const section = await renderSection('owner')
    expect(
      await within(section).findByRole('switch', {
        name: 'Send matter documents to the model provider',
      }),
    ).toBeTruthy()
  })
})
