/*
 * Preflight regressions for the editor-interaction runner.
 *
 * A missing fixture id used to reach the browser as `/matters/undefined/...`
 * and end as a 180 s selector timeout, and a target the signed-in user could
 * not read did the same. These pin the two failures separately: the local key
 * check that runs before a browser exists, and the authenticated reachability
 * check that runs before any probe.
 *
 * The reachability cases go through a real HTTP listener rather than a stubbed
 * response object, because the thing under test is how a status code from the
 * API is turned into a named refusal.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { afterAll, test } from 'bun:test'
import {
  assertTargetsReachable,
  resolveProbeTargets,
} from './probe-preflight.mjs'

const servers = []

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise((resolve) => {
          server.closeAllConnections?.()
          server.close(resolve)
        }),
    ),
  )
})

/** A real HTTP boundary, reached exactly as the harness's API client reaches it. */
async function apiStub(statusByPath) {
  const server = createServer((req, res) => {
    const status = statusByPath[req.url] ?? 500
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status }))
  })
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    apiUrl: `http://127.0.0.1:${server.address().port}`,
    // Same shape as Playwright's APIResponse, which the CLI passes in.
    get: (url) =>
      fetch(url).then((response) => ({
        status: () => response.status,
        ok: () => response.ok,
      })),
  }
}

const check = (get, apiUrl, matterId, documents) =>
  assertTargetsReachable({ get, apiUrl, matterId, documents })

test('missing fixture keys are named before any browser starts', () => {
  assert.throws(() => resolveProbeTargets({}, ['typing']), /"matterId"/)
  assert.throws(
    () => resolveProbeTargets({ matterId: 'mtr_1' }, ['typing']),
    /"documentId"/,
  )
  assert.throws(
    () => resolveProbeTargets({ matterId: 'mtr_1' }, ['save']),
    /"saveDocumentId"/,
  )
})

test('malformed fixture ids are refused rather than interpolated', () => {
  for (const documentId of ['', '   ', 'undefined', 'null', 'doc/1', 42, {}]) {
    assert.throws(
      () => resolveProbeTargets({ matterId: 'mtr_1', documentId }, ['typing']),
      /"documentId"/,
      `expected ${JSON.stringify(documentId)} to be refused`,
    )
  }
})

test('only the keys the selected modes read are required', () => {
  assert.deepEqual(
    resolveProbeTargets({ matterId: 'mtr_1', saveDocumentId: 'doc_2' }, [
      'save',
    ]),
    {
      matterId: 'mtr_1',
      documents: [{ key: 'saveDocumentId', id: 'doc_2' }],
    },
  )
  assert.deepEqual(
    resolveProbeTargets(
      { matterId: 'mtr_1', documentId: 'doc_1', saveDocumentId: 'doc_2' },
      ['typing', 'scroll', 'save'],
    ),
    {
      matterId: 'mtr_1',
      documents: [
        { key: 'documentId', id: 'doc_1' },
        { key: 'saveDocumentId', id: 'doc_2' },
      ],
    },
  )
})

test('readable targets pass the authenticated preflight', async () => {
  const stub = await apiStub({
    '/api/matters/mtr_1/documents': 200,
    '/api/documents/doc_1': 200,
  })
  await check(stub.get, stub.apiUrl, 'mtr_1', [
    { key: 'documentId', id: 'doc_1' },
  ])
})

test('a matter the session cannot read is refused by name', async () => {
  const stub = await apiStub({ '/api/matters/mtr_1/documents': 404 })
  await assert.rejects(
    () => check(stub.get, stub.apiUrl, 'mtr_1', []),
    /"matterId".*HTTP 404.*not shared with this user/s,
  )
})

test('a document the session cannot read is refused by name', async () => {
  const stub = await apiStub({
    '/api/matters/mtr_1/documents': 200,
    '/api/documents/doc_1': 200,
    '/api/documents/doc_9': 403,
  })
  await assert.rejects(
    () =>
      check(stub.get, stub.apiUrl, 'mtr_1', [
        { key: 'documentId', id: 'doc_1' },
        { key: 'saveDocumentId', id: 'doc_9' },
      ]),
    /"saveDocumentId".*HTTP 403.*not authorised/s,
  )
})

test('an unreachable API is named rather than read as a missing target', async () => {
  await assert.rejects(
    () =>
      check(
        () => Promise.reject(new Error('connect ECONNREFUSED')),
        'http://127.0.0.1:1',
        'mtr_1',
        [],
      ),
    /could not reach the API for "matterId".*ECONNREFUSED/s,
  )
})
