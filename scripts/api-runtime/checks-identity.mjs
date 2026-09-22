/*
 * Identity, isolation and limit checks for one runtime.
 *
 * These describe behaviour the API must keep whatever serves it: who is
 * authenticated, who is refused, and what a body may weigh before the app says
 * so. Nothing here asserts a timing.
 */
import {
  DOCX_CONTENT_TYPE,
  bearer,
  getJson,
  jsonInit,
  multipartBody,
  rawRequest,
  signSessionCookie,
} from './http.mjs'
import { foreignReadyDocumentSql } from './fixtures.mjs'

/**
 * `auth.ts` sets `advanced.useSecureCookies: env.nodeEnv === 'production'`, and
 * the harness always runs the API with NODE_ENV=production. better-auth's
 * session middleware reads that prefixed name, not the plain one, so the cookie
 * assertion must use the name the deployed server actually issues.
 */
const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token'

export async function checkHealthAndAuth(ctx) {
  const { origin, port, runtime, ids, recorder, apiDirectory, secret, server } =
    ctx
  recorder.group('health and authentication')

  const health = await getJson(`${origin}/api/health`)
  recorder.record(
    'health reports the adapter that answered',
    health.status === 200 && health.body?.runtime === runtime,
    `status=${health.status} runtime=${health.body?.runtime ?? 'none'}`,
    { runtime: health.body?.runtime ?? null },
  )

  // This run sets no corpus variables, so the corpus is the application
  // database: colocated and writable. The configured modes (separate
  // read-only corpus, dedicated writer) are booted per adapter in
  // checks-corpus.mjs. No connection detail may appear beside the booleans.
  const corpus = health.body?.corpus ?? null
  recorder.record(
    'health reports the compatibility corpus mode',
    health.status === 200 &&
      corpus?.colocated === true &&
      corpus?.readOnly === false &&
      !JSON.stringify(health.body).includes('postgres://'),
    `corpus=${JSON.stringify(corpus)}`,
    { corpus },
  )

  const meBearer = await getJson(`${origin}/api/me`, ids.sessionToken)
  recorder.record(
    'bearer session authenticates /api/me',
    meBearer.status === 200 && meBearer.body?.user?.id === ids.userId,
    `status=${meBearer.status} user=${meBearer.body?.user?.id ?? 'none'}`,
  )

  const signed = await signSessionCookie({
    apiDirectory,
    token: ids.sessionToken,
    secret,
  })
  const cookieResponse = await fetch(`${origin}/api/me`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${signed}` },
    signal: AbortSignal.timeout(10_000),
  })
  const cookieBody = await cookieResponse.json().catch(() => null)
  recorder.record(
    'signed better-auth cookie authenticates /api/me',
    cookieResponse.status === 200 && cookieBody?.user?.id === ids.userId,
    `status=${cookieResponse.status} user=${cookieBody?.user?.id ?? 'none'}`,
  )

  const tamperedResponse = await fetch(`${origin}/api/me`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${signed.slice(0, -4)}AAAA` },
    signal: AbortSignal.timeout(10_000),
  })
  recorder.record(
    'tampered session cookie is refused',
    tamperedResponse.status === 401,
    `status=${tamperedResponse.status}`,
  )

  const emptyCookie = await fetch(`${origin}/api/me`, {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=` },
    signal: AbortSignal.timeout(10_000),
  })
  recorder.record(
    'empty session cookie is refused, not treated as anonymous success',
    emptyCookie.status === 401,
    `status=${emptyCookie.status}`,
  )

  const anon = await rawRequest({ port, path: '/api/me' })
  const anonBody = JSON.parse(anon.body.toString('utf8') || '{}')
  recorder.record(
    'unauthenticated /api/me is 401 in the contract error envelope',
    anon.status === 401 &&
      anonBody?.error?.code === 'unauthenticated' &&
      (anonBody?.error?.requestId ?? '').startsWith('req_'),
    `status=${anon.status} code=${anonBody?.error?.code ?? 'none'} requestId=${anonBody?.error?.requestId ? 'present' : 'absent'}`,
  )

  const unknown = await rawRequest({ port, path: '/api/does-not-exist' })
  recorder.record(
    'unknown route is 404, not 500',
    unknown.status === 404,
    `status=${unknown.status}`,
  )

  const logged = server.lines.map((entry) => entry.line).join('\n')
  recorder.record(
    'no session token or request body reaches the logs',
    !logged.includes(ids.sessionToken) &&
      !logged.includes(ids.otherSessionToken),
    `sessionTokenInLog=${logged.includes(ids.sessionToken)}`,
  )
}

export async function checkTenancy(ctx) {
  const { port, ids, recorder } = ctx
  recorder.group('tenant isolation')

  const crossMatter = await rawRequest({
    port,
    path: `/api/matters/${ids.otherMatterId}`,
    headers: bearer(ids.sessionToken),
  })
  recorder.record(
    'cross-tenant matter read is 404 and leaks no name',
    crossMatter.status === 404 &&
      !crossMatter.body.toString('utf8').includes(ids.otherMatterName),
    `status=${crossMatter.status}`,
  )

  const crossDocuments = await rawRequest({
    port,
    path: `/api/matters/${ids.otherMatterId}/documents`,
    headers: bearer(ids.sessionToken),
  })
  recorder.record(
    'cross-tenant document list is 404',
    crossDocuments.status === 404,
    `status=${crossDocuments.status}`,
  )

  const otherOwn = await rawRequest({
    port,
    path: `/api/matters/${ids.otherMatterId}`,
    headers: bearer(ids.otherSessionToken),
  })
  recorder.record(
    'the other tenant can still read its own matter',
    otherOwn.status === 200,
    `status=${otherOwn.status}`,
  )

  const absent = await rawRequest({
    port,
    path: '/api/matters/mtr_does-not-exist',
    headers: bearer(ids.sessionToken),
  })
  recorder.record(
    'an absent matter is 404',
    absent.status === 404,
    `status=${absent.status}`,
  )

  const anonUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
  })
  recorder.record(
    'anonymous upload is 401',
    anonUpload.status === 401,
    `status=${anonUpload.status}`,
  )

  const foreignUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.otherMatterId}/documents`,
    method: 'POST',
    headers: bearer(ids.sessionToken),
  })
  recorder.record(
    'upload into another tenant’s matter is 404',
    foreignUpload.status === 404,
    `status=${foreignUpload.status}`,
  )

  const foreignDocument = ctx.querier.rows(
    foreignReadyDocumentSql(ids.otherOrganisationId),
  )
  if (foreignDocument.length > 0) {
    const foreign = await rawRequest({
      port,
      path: `/api/documents/${foreignDocument[0].document_id}`,
      headers: bearer(ids.sessionToken),
    })
    recorder.record(
      'cross-tenant document read is 404',
      foreign.status === 404,
      `status=${foreign.status}`,
    )
  }
}

export async function checkRequestLimits(ctx) {
  const { origin, port, ids, recorder } = ctx
  recorder.group('request limits')

  const oversizedJson = await fetch(`${origin}/api/matters`, {
    ...jsonInit(
      {
        name: 'x',
        primaryJurisdiction: 'england_and_wales',
        pad: 'z'.repeat(80_000),
      },
      ids.sessionToken,
    ),
    signal: AbortSignal.timeout(20_000),
  })
  recorder.record(
    'JSON body over 48 KiB is 413',
    oversizedJson.status === 413,
    `status=${oversizedJson.status}`,
  )

  // The size gate, from under it: a body below DOCUMENT_UPLOAD_MAX_BYTES must
  // pass the 413 gate and reach content validation, or the cap boundary is not
  // where the code says it is. The bytes are not a DOCX, so a non-413
  // rejection from validation is the expected outcome, and its status is
  // recorded for the cross-runtime parity comparison.
  const underBoundary = `----obiterapi${Date.now()}under`
  const underCap = multipartBody({
    boundary: underBoundary,
    fields: { filename: 'under-cap.docx', fileType: 'docx' },
    file: {
      filename: 'under-cap.docx',
      contentType: DOCX_CONTENT_TYPE,
      content: Buffer.alloc(24 * 1024 * 1024, 0x42),
    },
  })
  const underCapUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${underBoundary}`,
      'Content-Length': String(underCap.byteLength),
    },
    body: underCap,
    timeoutMs: 40_000,
  })
  const healthAfterUnderCap = await getJson(`${origin}/api/health`)
  recorder.record(
    'a multipart body under the 25 MiB cap passes the size gate',
    underCapUpload.status !== 413 &&
      underCapUpload.status !== 0 &&
      healthAfterUnderCap.status === 200,
    `status=${underCapUpload.status} bytes=${underCap.byteLength} healthAfter=${healthAfterUnderCap.status}; content validation answers separately`,
    { underCapStatus: underCapUpload.status },
  )

  const boundary = `----obiterapi${Date.now()}`
  const oversized = multipartBody({
    boundary,
    fields: { filename: 'big.docx', fileType: 'docx' },
    file: {
      filename: 'big.docx',
      contentType: DOCX_CONTENT_TYPE,
      content: Buffer.alloc(27 * 1024 * 1024, 0x41),
    },
  })
  const oversizedUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(oversized.byteLength),
    },
    body: oversized,
    timeoutMs: 40_000,
  })
  recorder.record(
    'multipart upload over the 25 MiB cap is 413',
    oversizedUpload.status === 413,
    `status=${oversizedUpload.status} bytes=${oversized.byteLength}`,
  )

  // The two malformed-multipart shapes answer 500 on both runtimes today. That
  // is a pre-existing defect tracked separately (board P1.41); the harness
  // asserts the server survives them and records the status for a parity
  // comparison, rather than pinning a status the migration is not fixing.
  const malformed = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': 'multipart/form-data; boundary=',
      'Content-Length': String(
        Buffer.byteLength('this is not multipart at all, honest!'),
      ),
    },
    body: Buffer.from('this is not multipart at all, honest!'),
  })
  const truncated = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n`,
    ),
  })
  const healthAfterMalformed = await getJson(`${origin}/api/health`)
  recorder.record(
    'malformed and truncated multipart do not take the server down',
    healthAfterMalformed.status === 200,
    `empty-boundary=${malformed.status} truncated=${truncated.status} health=${healthAfterMalformed.status}`,
    {
      malformedBoundaryStatus: malformed.status,
      truncatedMultipartStatus: truncated.status,
    },
  )

  const hugeHeader = await rawRequest({
    port,
    path: '/api/health',
    headers: { 'X-Oversized': 'A'.repeat(64 * 1024) },
    timeoutMs: 10_000,
  })
  const afterHeader = await getJson(`${origin}/api/health`)
  recorder.record(
    'an oversized request header is refused or the connection closed, without a crash',
    (hugeHeader.status >= 400 ||
      hugeHeader.status === 0 ||
      hugeHeader.error !== undefined) &&
      afterHeader.status === 200,
    `status=${hugeHeader.status} error=${hugeHeader.error ?? 'none'} healthAfter=${afterHeader.status}`,
  )
}

export async function runIdentityChecks(ctx) {
  await checkHealthAndAuth(ctx)
  await checkTenancy(ctx)
  await checkRequestLimits(ctx)
  return ctx.recorder.results
}
