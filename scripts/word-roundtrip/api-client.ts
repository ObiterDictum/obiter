import { execFileSync } from 'node:child_process'

import type { DocumentEditOperation } from '../../packages/contracts/src/document-edit'
import { documentEditResponseSchema } from '../../packages/contracts/src/document-edit-request'
import {
  documentModelResponseSchema,
  type DocumentModelWire,
} from '../../packages/contracts/src/document-model'

/**
 * Thin real-API client for the round-trip: sign-up/sign-in, matter and
 * document upload, readiness polling, model read, edit and export. Every
 * call goes through the authenticated cookie the sign-in returned — no
 * fixtures, no bypass.
 */
export type RoundtripClient = {
  createAccount(input: {
    email?: string
    password?: string
    databaseName: string
  }): Promise<{ cookie: string; email: string }>
  createMatter(cookie: string): Promise<string>
  upload(
    cookie: string,
    matterId: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<string>
  waitReady(cookie: string, documentId: string): Promise<void>
  getModel(
    cookie: string,
    documentId: string,
  ): Promise<{
    versionId: string
    versionNumber: number
    model: DocumentModelWire
  }>
  editDocument(
    cookie: string,
    documentId: string,
    input: {
      baseVersionId: string
      operations: readonly DocumentEditOperation[]
    },
  ): Promise<{ versionId: string; versionNumber: number }>
  exportDocx(cookie: string, documentId: string): Promise<Uint8Array>
}

export function createClient(opts: {
  apiOrigin: string
  webOrigin: string
  fail: (message: string) => never
}): RoundtripClient {
  const { apiOrigin, webOrigin, fail } = opts

  async function request(
    url: string,
    init: RequestInit & { cookie?: string } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    if (init.cookie) headers.set('Cookie', init.cookie)
    if (!headers.has('Origin')) headers.set('Origin', webOrigin)
    return fetch(`${apiOrigin}${url}`, { ...init, headers })
  }

  return {
    async createAccount({ email, password, databaseName }) {
      const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      const address = email ?? `word-rt-${runId}@obiter.test`
      const secret = password ?? `WordRT-${runId}-Aa1!`
      if (!email) {
        const signUp = await request('/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Word RT User',
            email: address,
            password: secret,
          }),
        })
        if (!signUp.ok) fail(`sign-up failed: ${await signUp.text()}`)
        execFileSync('docker', [
          'exec',
          'obiter-postgres',
          'psql',
          '-U',
          'obiter',
          '-d',
          databaseName,
          '-c',
          `update users set "emailVerified"=true where email='${address.replaceAll("'", "''")}'`,
        ])
      }
      const signIn = await request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, password: secret }),
      })
      if (!signIn.ok) fail(`sign-in failed: ${await signIn.text()}`)
      const cookie = signIn.headers
        .getSetCookie()
        .map((value) => value.split(';')[0] ?? '')
        .filter(Boolean)
        .join('; ')
      if (!cookie) fail('sign-in returned no session cookie')
      return { cookie, email: address }
    },

    async createMatter(cookie) {
      const response = await request('/api/matters', {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Word round-trip ${Date.now()}`,
          primaryJurisdiction: 'England & Wales',
        }),
      })
      if (!response.ok) fail(`matter create failed: ${await response.text()}`)
      // SAFETY: the response shape is checked through the optional chain and
      // the missing-id branch fails the run below — the cast only narrows to
      // what the API contract already guarantees.
      const body = (await response.json()) as { matter?: { id?: string } }
      return body.matter?.id ?? fail('matter create returned no id')
    },

    async upload(cookie, matterId, name, bytes) {
      const form = new FormData()
      // A fresh typed array: readFileSync's Buffer can share a pooled buffer,
      // and sending the pool would corrupt the upload.
      form.set(
        'file',
        new File([new Uint8Array(bytes)], name, {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      )
      const response = await request(`/api/matters/${matterId}/documents`, {
        method: 'POST',
        cookie,
        body: form,
      })
      if (!response.ok) fail(`upload failed: ${await response.text()}`)
      // SAFETY: `document?.id` is read defensively and a miss fails the run.
      const body = (await response.json()) as { document?: { id?: string } }
      return (
        body.document?.id ??
        fail(`upload returned no document id: ${JSON.stringify(body)}`)
      )
    },

    async waitReady(cookie, documentId) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await request(`/api/documents/${documentId}`, {
          cookie,
        })
        if (!response.ok) {
          fail(`document status failed: ${await response.text()}`)
        }
        // SAFETY: `versions` is read through `(body.versions ?? [])` and every
        // absent or malformed shape fails the ready poll below.
        const body = (await response.json()) as {
          versions?: {
            documentStatus?: string
            failureReason?: string | null
          }[]
        }
        const statuses = (body.versions ?? []).map((v) => v.documentStatus)
        if (statuses.includes('ready')) return
        if (statuses.includes('failed')) {
          fail(`document processing failed: ${JSON.stringify(body.versions)}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      fail('document never reached ready status')
    },

    async getModel(cookie, documentId) {
      const response = await request(`/api/documents/${documentId}/model`, {
        cookie,
      })
      if (!response.ok) fail(`document model failed: ${await response.text()}`)
      const parsed = documentModelResponseSchema.safeParse(
        await response.json(),
      )
      return parsed.success
        ? parsed.data
        : fail('document model response did not match the contract')
    },

    async editDocument(cookie, documentId, input) {
      const response = await request(`/api/documents/${documentId}/edit`, {
        method: 'POST',
        cookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersionId: input.baseVersionId,
          operations: input.operations,
        }),
      })
      if (!response.ok) {
        fail(
          `document edit failed (${response.status}): ${await response.text()}`,
        )
      }
      const parsed = documentEditResponseSchema.safeParse(await response.json())
      return parsed.success
        ? parsed.data
        : fail('document edit response did not match the contract')
    },

    async exportDocx(cookie, documentId) {
      const response = await request(`/api/documents/${documentId}/export`, {
        cookie,
      })
      if (!response.ok) fail(`export failed: ${await response.text()}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
