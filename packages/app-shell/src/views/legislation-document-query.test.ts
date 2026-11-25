import '@obiter/test-dom'
import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { clearDesktopAuthToken } from '../lib/auth-token'
import {
  legislationActsQueryOptions,
  prefetchLegislationPage,
} from './legislation-document-query'

it('authenticates desktop requests for Acts, provisions, and the held Acts list', async () => {
  const client = new QueryClient()
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ act: {} }))
    .mockResolvedValueOnce(Response.json({ provision: {} }))
    .mockResolvedValueOnce(Response.json({ acts: [] }))
  Object.defineProperty(window, 'obiterDesktop', {
    configurable: true,
    value: {
      apiOrigin: 'https://app.obiter.si',
      getAuthToken: async () => 'desktop-test-token',
      clearAuthToken: async () => {},
    },
  })

  try {
    await prefetchLegislationPage(client, 'ukpga/2010/15')
    await prefetchLegislationPage(client, 'ukpga/2010/15/section/1')
    await client.fetchQuery(legislationActsQueryOptions())

    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        String(url),
        new Headers(init?.headers).get('authorization'),
      ]),
    ).toEqual([
      [
        'https://app.obiter.si/api/search/legislation/ukpga/2010/15',
        'Bearer desktop-test-token',
      ],
      [
        'https://app.obiter.si/api/search/legislation/ukpga/2010/15/section/1',
        'Bearer desktop-test-token',
      ],
      [
        'https://app.obiter.si/api/search/legislation/acts',
        'Bearer desktop-test-token',
      ],
    ])
  } finally {
    await clearDesktopAuthToken()
    Reflect.deleteProperty(window, 'obiterDesktop')
    fetchMock.mockRestore()
    client.clear()
  }
})
