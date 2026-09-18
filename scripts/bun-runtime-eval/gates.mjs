#!/usr/bin/env node
/*
 * Runtime compatibility and correctness gates.
 *
 * Runs the same assertions against whichever API the harness started, so a
 * "pass" means the candidate behaved identically on that check, not that it
 * merely booted. Every check prints PASS/FAIL with the observed value; a FAIL
 * is a migration blocker, not a warning.
 *
 *   node scripts/bun-runtime-eval/gates.mjs --runtime node --out /tmp/g-node.json
 *   node scripts/bun-runtime-eval/gates.mjs --runtime bun  --out /tmp/g-bun.json
 *
 * Reuses `provision.mjs` for the authorized synthetic session (a real
 * `sessions` row validated by better-auth on every request), the repo's
 * `make-upload-fixtures.py` for a genuine DOCX, and the API's own routes to
 * create every fixture. No signup, magic-link or password-reset flow is
 * invoked and no email is sent.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { Agent, request as httpRequest } from 'node:http'
import { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { deflateRawSync } from 'node:zlib'
import {
  buildFixtures,
  DOCX_CONTENT_TYPE,
  fixtureFilename,
} from '../load/fixtures.mjs'
import { createQuerier } from '../load/psql.mjs'
import { fixtureIds, newRunTag, provisionFixtures } from '../load/provision.mjs'
import { databaseNameFromUrl, readEnvAssignment } from '../load/target.mjs'

const WORKTREE = resolve(import.meta.dirname, '..', '..')
const API_DIR = join(WORKTREE, 'services', 'api')
const ENV_FILE = join(WORKTREE, '.env')
const BUN_BIN =
  process.env.BUN_EVAL_BUN ?? '/tmp/obiter-bun-eval/tools/bun-linux-x64/bun'
const TSX_CLI = join(WORKTREE, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const OWNED_DATABASE = 'obiter_bun_eval'
const SECRET = readEnvAssignment(
  await readFile(ENV_FILE, 'utf8'),
  'BETTER_AUTH_SECRET',
)

const RUNTIMES = {
  node: () => ({ command: process.execPath, args: [TSX_CLI, 'src/server.ts'] }),
  bun: () => ({ command: BUN_BIN, args: ['run', 'src/server-bun.ts'] }),
}

// ------------------------------------------------------------------ harness

const checks = []
let currentGroup = 'general'
/** The DOCX uploaded by the upload gate; the shutdown gate downloads it. */
let lastUploadedDocumentId = null

function group(name) {
  currentGroup = name
}

function record(name, ok, detail, extra = {}) {
  checks.push({ group: currentGroup, name, ok: Boolean(ok), detail, ...extra })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${currentGroup} :: ${name} — ${detail}`)
}

function parseArgs(argv) {
  const out = { runtime: null, out: null, port: 8811 }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--runtime') out.runtime = argv[++i]
    else if (argv[i] === '--out') out.out = argv[++i]
    else if (argv[i] === '--port') out.port = Number(argv[++i])
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  if (!RUNTIMES[out.runtime]) throw new Error('--runtime node|bun')
  if (!out.out) throw new Error('--out is required')
  return out
}

async function startServer({ runtime, port, logPath }) {
  const spec = RUNTIMES[runtime]()
  const child = spawn(spec.command, spec.args, {
    cwd: API_DIR,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const log = []
  const collect = (chunk) => log.push(chunk.toString())
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const started = performance.now()
  const origin = `http://127.0.0.1:${port}`
  while (performance.now() - started < 120_000) {
    if (child.exitCode !== null)
      throw new Error(`${runtime} exited ${child.exitCode}:\n${log.join('')}`)
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        await sleep(3000)
        await writeFile(logPath, log.join(''), 'utf8').catch(() => {})
        return { child, origin, log, readyMs: performance.now() - started }
      }
    } catch {
      // not up yet
    }
    await sleep(50)
  }
  throw new Error(`${runtime} never became ready`)
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return
  try {
    process.kill(-server.child.pid, 'SIGTERM')
  } catch {
    server.child.kill('SIGTERM')
  }
  const deadline = Date.now() + 12_000
  while (server.child.exitCode === null && Date.now() < deadline)
    await sleep(100)
  if (server.child.exitCode === null) {
    try {
      process.kill(-server.child.pid, 'SIGKILL')
    } catch {
      server.child.kill('SIGKILL')
    }
  }
}

const bearer = (token) => (token ? { Authorization: `Bearer ${token}` } : {})
const json = (body, token, extra = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...bearer(token), ...extra },
  body: JSON.stringify(body),
})

async function rawRequest({
  port,
  path,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15_000,
}) {
  return new Promise((done) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method, headers },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          done({
            status: response.statusCode,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('client_timeout'))
    })
    request.on('error', (error) =>
      done({
        status: 0,
        headers: {},
        rawHeaders: [],
        body: Buffer.alloc(0),
        error: error.message,
      }),
    )
    if (body) request.write(body)
    request.end()
  })
}

/**
 * A bounded multipart body, assembled by hand so Content-Length is known and
 * the byte count is exact — which is what the body-limit checks need.
 */
function multipartBody({ fields = {}, file = null, boundary }) {
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

// -------------------------------------------------------------------- checks

async function runGates({ origin, port, ids, fixtures, querier, runTag }) {
  const _medium = fixtures.find((entry) => entry.size === 'medium')
  const small = fixtures.find((entry) => entry.size === 'small')
  const originHeader = 'http://localhost:3004'

  // ---- authentication: cookie, bearer, and no-credential refusals
  group('authentication')

  const meBearer = await fetch(`${origin}/api/me`, {
    headers: bearer(ids.sessionToken),
  })
  const meBearerBody = await meBearer.json().catch(() => null)
  record(
    'bearer session authenticates /api/me',
    meBearer.status === 200 && meBearerBody?.user?.id === ids.userId,
    `status=${meBearer.status} user=${meBearerBody?.user?.id ?? 'none'}`,
  )

  const signedCookie = await signSessionCookie(ids.sessionToken)
  const meCookie = await fetch(`${origin}/api/me`, {
    headers: { Cookie: `better-auth.session_token=${signedCookie}` },
  })
  const meCookieBody = await meCookie.json().catch(() => null)
  record(
    'signed better-auth cookie authenticates /api/me',
    meCookie.status === 200 && meCookieBody?.user?.id === ids.userId,
    `status=${meCookie.status} user=${meCookieBody?.user?.id ?? 'none'}`,
  )

  const tampered = `${signedCookie.slice(0, -4)}AAAA`
  const meTampered = await fetch(`${origin}/api/me`, {
    headers: { Cookie: `better-auth.session_token=${tampered}` },
  })
  record(
    'tampered session cookie is refused',
    meTampered.status === 401,
    `status=${meTampered.status}`,
  )

  const meAnon = await fetch(`${origin}/api/me`)
  record(
    'unauthenticated /api/me is 401',
    meAnon.status === 401,
    `status=${meAnon.status}`,
  )

  const emptyCookie = await fetch(`${origin}/api/me`, {
    headers: { Cookie: 'better-auth.session_token=' },
  })
  record(
    'empty session cookie is refused, not accepted as anonymous',
    emptyCookie.status === 401,
    `status=${emptyCookie.status}`,
  )

  const weirdCookie = await fetch(`${origin}/api/me`, {
    headers: {
      Cookie: 'better-auth.session_token="quoted;value"; junk; other=a=b',
    },
  })
  record(
    'malformed cookie header does not 500',
    weirdCookie.status === 401,
    `status=${weirdCookie.status}`,
  )

  // ---- authorization: cross-tenant refusal and non-enumeration
  group('authorization')

  const crossMatter = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}`,
    {
      headers: bearer(ids.sessionToken),
    },
  )
  const crossMatterBody = await crossMatter.json().catch(() => null)
  record(
    'cross-tenant matter read is 404 and leaks no name',
    crossMatter.status === 404 &&
      !JSON.stringify(crossMatterBody ?? {}).includes(ids.otherMatterName),
    `status=${crossMatter.status}`,
  )

  const crossDocuments = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}/documents`,
    { headers: bearer(ids.sessionToken) },
  )
  record(
    'cross-tenant document list is 404',
    crossDocuments.status === 404,
    `status=${crossDocuments.status}`,
  )

  const otherSeesOwn = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}`,
    {
      headers: bearer(ids.otherSessionToken),
    },
  )
  record(
    'the other tenant can read its own matter (the refusal is tenancy, not a broken route)',
    otherSeesOwn.status === 200,
    `status=${otherSeesOwn.status}`,
  )

  const absentMatter = await fetch(`${origin}/api/matters/mtr_does-not-exist`, {
    headers: bearer(ids.sessionToken),
  })
  record(
    'absent matter is 404',
    absentMatter.status === 404,
    `status=${absentMatter.status}`,
  )

  const anonUpload = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    {
      method: 'POST',
      body: new FormData(),
    },
  )
  record(
    'anonymous upload is 401',
    anonUpload.status === 401,
    `status=${anonUpload.status}`,
  )

  const otherMatterUpload = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}/documents`,
    { method: 'POST', headers: bearer(ids.sessionToken), body: new FormData() },
  )
  record(
    'upload into another tenant’s matter is 404',
    otherMatterUpload.status === 404,
    `status=${otherMatterUpload.status}`,
  )

  // A cross-tenant *document* id, not just a matter id: the two are different
  // authorization paths and both must refuse.
  const foreignDocument = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select d.id as document_id, v.id as version_id
      from matter_documents d
      join document_versions v on v.id = d.current_version_id
      where d.organisation_id = '${ids.otherOrganisationId}' and v.document_status = 'ready'
      limit 1
    ) r`)
  if (foreignDocument.length > 0) {
    const foreignRead = await fetch(
      `${origin}/api/documents/${foreignDocument[0].document_id}`,
      { headers: bearer(ids.sessionToken) },
    )
    record(
      'cross-tenant document read is 404',
      foreignRead.status === 404,
      `status=${foreignRead.status}`,
    )
    const foreignDownload = await fetch(
      `${origin}/api/documents/${foreignDocument[0].document_id}/download`,
      { headers: bearer(ids.sessionToken) },
    )
    record(
      'cross-tenant document download is 404',
      foreignDownload.status === 404,
      `status=${foreignDownload.status}`,
    )
  } else {
    record(
      'cross-tenant document read is 404',
      false,
      'no ready document in the other tenant',
    )
  }

  // ---- CORS
  group('cors')

  const preflight = await rawRequest({
    port,
    path: '/api/matters',
    method: 'OPTIONS',
    headers: {
      Origin: originHeader,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  })
  record(
    'preflight from an allowed origin is 204 with credentials',
    (preflight.status === 204 || preflight.status === 200) &&
      preflight.headers['access-control-allow-origin'] === originHeader &&
      preflight.headers['access-control-allow-credentials'] === 'true',
    `status=${preflight.status} allow-origin=${preflight.headers['access-control-allow-origin']} credentials=${preflight.headers['access-control-allow-credentials']}`,
  )

  const hostile = await rawRequest({
    port,
    path: '/api/matters',
    method: 'OPTIONS',
    headers: {
      Origin: 'http://evil.example.test',
      'Access-Control-Request-Method': 'GET',
    },
  })
  record(
    'preflight from an unknown origin gets no allow-origin',
    hostile.headers['access-control-allow-origin'] === undefined,
    `allow-origin=${hostile.headers['access-control-allow-origin'] ?? 'absent'}`,
  )

  const simpleHostile = await rawRequest({
    port,
    path: '/api/health',
    headers: { Origin: 'http://evil.example.test' },
  })
  record(
    'simple request from an unknown origin gets no allow-origin',
    simpleHostile.headers['access-control-allow-origin'] === undefined,
    `allow-origin=${simpleHostile.headers['access-control-allow-origin'] ?? 'absent'}`,
  )

  // ---- request body limits
  group('request limits')

  const oversizedJson = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    json(
      {
        filename: 'x',
        fileType: 'docx',
        contentSha256: 'a'.repeat(64),
        sizeBytes: 1,
        pad: 'z'.repeat(80_000),
      },
      ids.sessionToken,
    ),
  )
  record(
    'JSON body over 48 KiB is 413',
    oversizedJson.status === 413,
    `status=${oversizedJson.status} body=${(await oversizedJson.text()).slice(0, 80)}`,
  )

  const boundary = `----obitereval${Date.now()}`
  const oversizedMultipart = multipartBody({
    boundary,
    fields: { filename: 'big.docx', fileType: 'docx' },
    file: {
      filename: 'big.docx',
      contentType: DOCX_CONTENT_TYPE,
      // 27 MiB, above the API's 25 MiB multipart cap.
      content: Buffer.alloc(27 * 1024 * 1024, 0x41),
    },
  })
  const overUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(oversizedMultipart.byteLength),
    },
    body: oversizedMultipart,
    timeoutMs: 30_000,
  })
  const overUploadBody = overUpload.body.toString('utf8').slice(0, 200)
  record(
    'multipart upload over the 25 MiB cap is 413',
    overUpload.status === 413,
    `status=${overUpload.status} bytes=${oversizedMultipart.byteLength} body=${overUploadBody.slice(0, 100)}`,
  )

  const malformedBoundary = await rawRequest({
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
  record(
    'malformed multipart answers 4xx, not 500',
    malformedBoundary.status >= 400 && malformedBoundary.status < 500,
    `status=${malformedBoundary.status} body=${malformedBoundary.body.toString('utf8').slice(0, 120)}`,
  )

  const truncatedMultipart = await rawRequest({
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
  record(
    'truncated multipart is rejected, not accepted as an empty document',
    truncatedMultipart.status >= 400 && truncatedMultipart.status < 500,
    `status=${truncatedMultipart.status} body=${truncatedMultipart.body.toString('utf8').slice(0, 120)}`,
  )

  // An oversized header is a transport-level limit, not an application one:
  // Node caps request headers at 16 KiB by default; Bun exposes no such knob.
  const hugeHeader = await rawRequest({
    port,
    path: '/api/health',
    headers: { 'X-Oversized': 'A'.repeat(64 * 1024) },
    timeoutMs: 10_000,
  })
  record(
    'an oversized request header is rejected or the connection closed',
    hugeHeader.status === 431 ||
      (hugeHeader.status >= 400 && hugeHeader.status < 500) ||
      hugeHeader.error !== undefined,
    `status=${hugeHeader.status} error=${hugeHeader.error ?? 'none'}`,
    {
      observed: { status: hugeHeader.status, error: hugeHeader.error ?? null },
    },
  )

  // Some clients (curl for large bodies) send Expect: 100-continue. Node's
  // http server has an explicit checkContinue path; Bun surfaces no API.
  const expectContinue = await expectContinueUpload({
    port,
    token: ids.sessionToken,
    matterId: ids.matterId,
    fixture: small,
  })
  record(
    'Expect: 100-continue upload is handled without hanging',
    expectContinue.status === 201,
    `interim=${expectContinue.interim} status=${expectContinue.status} ms=${Math.round(expectContinue.ms)}`,
    { observed: expectContinue },
  )

  // A chunked (no Content-Length) JSON body: Node's http server decodes
  // Transfer-Encoding, and the application's limit middleware must still see
  // and bound the streamed bytes.
  const chunked = await chunkedJsonPost({
    port,
    path: `/api/matters`,
    token: ids.sessionToken,
    payload: JSON.stringify({
      name: `gate-chunked-${runTag}`,
      primaryJurisdiction: 'england_and_wales',
    }),
  })
  record(
    'chunked (no Content-Length) request body is decoded',
    chunked.status === 201,
    `status=${chunked.status} chunked=${chunked.usedChunkedEncoding}`,
  )

  const chunkedOversized = await chunkedJsonPost({
    port,
    path: `/api/matters`,
    token: ids.sessionToken,
    payload: JSON.stringify({
      name: 'x'.repeat(70_000),
      primaryJurisdiction: 'england_and_wales',
    }),
  })
  record(
    'an oversized chunked body is refused with 413, not streamed forever',
    chunkedOversized.status === 413,
    `status=${chunkedOversized.status}`,
  )

  // ---- upload + extraction, happy path
  group('upload and extraction')

  const goodBoundary = `----obitereval${Date.now() + 1}`
  const goodMultipart = multipartBody({
    boundary: goodBoundary,
    fields: {
      filename: fixtureFilename(small),
      fileType: 'docx',
      sizeBytes: String(small.bytes),
      contentSha256: createHash('sha256').update(small.content).digest('hex'),
    },
    file: {
      filename: fixtureFilename(small),
      contentType: DOCX_CONTENT_TYPE,
      content: small.content,
    },
  })
  const goodUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${goodBoundary}`,
      'Content-Length': String(goodMultipart.byteLength),
    },
    body: goodMultipart,
    timeoutMs: 30_000,
  })
  const goodUploadBody = JSON.parse(goodUpload.body.toString('utf8') || '{}')
  record(
    'genuine DOCX uploads, extracts inline and reaches ready',
    goodUpload.status === 201 &&
      goodUploadBody?.version?.documentStatus === 'ready',
    `status=${goodUpload.status} documentStatus=${goodUploadBody?.version?.documentStatus} versionNumber=${goodUploadBody?.version?.versionNumber}`,
  )
  const uploadedDocumentId = goodUploadBody?.document?.id ?? null
  const _uploadedVersionId = goodUploadBody?.version?.id ?? null
  if (uploadedDocumentId) lastUploadedDocumentId = uploadedDocumentId
  record(
    'extraction wrote a text object key for the ready version',
    typeof goodUploadBody?.version?.textObjectKey === 'string' &&
      goodUploadBody.version.textObjectKey.length > 0,
    `textObjectKey=${goodUploadBody?.version?.textObjectKey ?? 'none'}`,
  )

  if (uploadedDocumentId) {
    const editorModel = await fetch(
      `${origin}/api/documents/${uploadedDocumentId}/model`,
      {
        headers: bearer(ids.sessionToken),
      },
    )
    record(
      'extracted DOCX is readable through the editor model route',
      editorModel.status === 200,
      `status=${editorModel.status}`,
    )

    const download = await rawRequest({
      port,
      path: `/api/documents/${uploadedDocumentId}/download`,
      headers: bearer(ids.sessionToken),
    })
    record(
      'download returns the byte-identical uploaded DOCX',
      download.status === 200 &&
        download.body.byteLength === small.bytes &&
        createHash('sha256').update(download.body).digest('hex') ===
          createHash('sha256').update(small.content).digest('hex'),
      `status=${download.status} bytes=${download.body.byteLength} expected=${small.bytes}`,
    )
    record(
      'download sets content-disposition and content-length',
      /attachment/.test(download.headers['content-disposition'] ?? '') &&
        Number(download.headers['content-length']) === small.bytes,
      `disposition=${download.headers['content-disposition']} length=${download.headers['content-length']}`,
    )

    // A DOCX whose ZIP is a bomb is refused by the ooxml limits, not extracted.
    const bombBoundary = `----obiterevalbomb${Date.now()}`
    const bomb = makeZipBomb()
    const bombMultipart = multipartBody({
      boundary: bombBoundary,
      fields: {
        filename: 'bomb.docx',
        fileType: 'docx',
        sizeBytes: String(bomb.byteLength),
      },
      file: {
        filename: 'bomb.docx',
        contentType: DOCX_CONTENT_TYPE,
        content: bomb,
      },
    })
    const bombUpload = await rawRequest({
      port,
      path: `/api/matters/${ids.matterId}/documents`,
      method: 'POST',
      headers: {
        ...bearer(ids.sessionToken),
        'Content-Type': `multipart/form-data; boundary=${bombBoundary}`,
        'Content-Length': String(bombMultipart.byteLength),
      },
      body: bombMultipart,
      timeoutMs: 30_000,
    })
    record(
      'compression-ratio-bomb DOCX is refused (4xx/413), not extracted',
      bombUpload.status >= 400 && bombUpload.status < 500,
      `status=${bombUpload.status} bytes=${bomb.byteLength}`,
    )
  }

  // ---- verification execution
  group('verification')

  const readyDoc = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select d.id as document_id, v.id as version_id
      from matter_documents d
      join document_versions v on v.id = d.current_version_id
      where d.matter_id = '${ids.matterId}' and v.document_status = 'ready'
      order by v.created_at desc limit 1
    ) r`)
  if (readyDoc.length > 0) {
    const verification = await fetch(
      `${origin}/api/documents/${readyDoc[0].document_id}/verification-runs`,
      json({ versionId: readyDoc[0].version_id }, ids.sessionToken),
    )
    const verificationBody = await verification.json().catch(() => null)
    record(
      'verification run executes and returns a run',
      verification.status === 201 &&
        typeof verificationBody?.run?.id === 'string',
      `status=${verification.status} run=${verificationBody?.run?.id ?? 'none'}`,
    )
    if (verificationBody?.run?.id) {
      const findings = await fetch(
        `${origin}/api/verification-runs/${verificationBody.run.id}/findings`,
        { headers: bearer(ids.sessionToken) },
      )
      const findingsBody = await findings.json().catch(() => null)
      record(
        'verification findings are readable',
        findings.status === 200 && Array.isArray(findingsBody?.findings),
        `status=${findings.status} findings=${findingsBody?.findings?.length ?? 'none'}`,
      )
    }
  } else {
    record(
      'verification run executes and returns a run',
      false,
      'no ready document to verify',
    )
  }

  // ---- native inference
  group('native inference')

  const inferenceText = Array.from(
    { length: 60 },
    (_, index) =>
      `Clause ${index + 1}. The parties acknowledge that Acme Holdings Limited, ` +
      `registered at 14 Fenchurch Street, London, and its director Ms Jane Whitfield ` +
      `(jane.whitfield@example.test, +44 7700 900123) shall keep the terms of this ` +
      `agreement confidential.`,
  ).join(' ')
  const inference = await fetch(
    `${origin}/api/redaction-runs`,
    json(
      {
        filename: `gate-${runTag}.txt`,
        text: inferenceText,
        policyMode: 'internal_ai_minimisation',
      },
      ids.sessionToken,
    ),
  )
  const inferenceBody = await inference.json().catch(() => null)
  const detectionMode = inferenceBody?.run?.detectionMode ?? null
  const spans =
    inferenceBody?.run?.spans?.length ?? inferenceBody?.spans?.length ?? 0
  record(
    'ONNX detection runs and reports model+supplement',
    inference.status === 201 &&
      detectionMode === 'model+supplement' &&
      spans > 0,
    `status=${inference.status} detectionMode=${detectionMode} spans=${spans}`,
  )

  const runId = inferenceBody?.run?.id
  if (runId) {
    // A text-only run has no layout artifact; the route must say 404 rather
    // than 500 or an empty body.
    const layout = await fetch(`${origin}/api/redaction-runs/${runId}/layout`, {
      headers: bearer(ids.sessionToken),
    })
    record(
      'text-only redaction run reports no layout as 404',
      layout.status === 404,
      `status=${layout.status}`,
    )
  }

  // ---- streaming and backpressure
  group('streaming')

  if (uploadedDocumentId) {
    const slow = await new Promise((done) => {
      const started = performance.now()
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/api/documents/${uploadedDocumentId}/download`,
          headers: bearer(ids.sessionToken),
        },
        (response) => {
          let bytes = 0
          let paused = 0
          response.on('data', (chunk) => {
            bytes += chunk.length
            paused += 1
            response.pause()
            setTimeout(() => response.resume(), 30)
          })
          response.on('end', () =>
            done({
              status: response.statusCode,
              bytes,
              paused,
              ms: performance.now() - started,
            }),
          )
        },
      )
      request.on('error', (error) =>
        done({ status: 0, bytes: 0, error: error.message }),
      )
      request.end()
    })
    record(
      'slow reader receives the whole body (backpressure does not truncate)',
      slow.status === 200 && slow.bytes === small.bytes,
      `status=${slow.status} bytes=${slow.bytes} expected=${small.bytes} pauses=${slow.paused} ms=${Math.round(slow.ms)}`,
    )
  }

  // Client disconnect mid-download: the server must not crash and must keep
  // serving. The document is the medium fixture, big enough that the body is
  // still in flight when the socket is destroyed.
  const mediumDoc = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select d.id as document_id
      from matter_documents d join document_versions v on v.id = d.current_version_id
      where d.matter_id = '${ids.matterId}' and v.document_status = 'ready' and v.size_bytes > 100000
      order by v.size_bytes desc limit 1
    ) r`)
  const disconnectTarget = mediumDoc[0]?.document_id ?? uploadedDocumentId
  if (disconnectTarget) {
    await new Promise((done) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/api/documents/${disconnectTarget}/download`,
          headers: bearer(ids.sessionToken),
        },
        (response) => {
          response.once('data', () => {
            request.destroy()
            done()
          })
          response.on('error', () => done())
        },
      )
      request.on('error', () => done())
      request.end()
    })
    await sleep(500)
    const afterDisconnect = await fetch(`${origin}/api/health`)
    record(
      'server survives a client disconnect mid-download',
      afterDisconnect.status === 200,
      `health after abort=${afterDisconnect.status}`,
    )
  }

  // ---- keep-alive and concurrency
  group('connections')

  const agent = new Agent({ keepAlive: true, maxSockets: 2 })
  const keepAliveStatuses = await Promise.all(
    Array.from(
      { length: 12 },
      () =>
        new Promise((done) => {
          const request = httpRequest(
            {
              host: '127.0.0.1',
              port,
              path: '/api/matters',
              headers: bearer(ids.sessionToken),
              agent,
            },
            (response) => {
              response.resume()
              response.on('end', () => done(response.statusCode))
            },
          )
          request.on('error', () => done(0))
          request.end()
        }),
    ),
  )
  const connectionReuse = agent.totalSocketCount
  agent.destroy()
  record(
    'keep-alive reuses sockets across 12 requests',
    keepAliveStatuses.every((status) => status === 200) && connectionReuse <= 2,
    `statuses=${[...new Set(keepAliveStatuses)].join(',')} sockets=${connectionReuse}`,
  )

  const concurrent = await Promise.all(
    Array.from({ length: 24 }, () =>
      fetch(`${origin}/api/matters`, {
        headers: bearer(ids.sessionToken),
      }).then((response) => response.status),
    ),
  )
  record(
    '24 concurrent authenticated requests all succeed',
    concurrent.every((status) => status === 200),
    `statuses=${[...new Set(concurrent)].join(',')}`,
  )

  const pipelined = await rawRequest({
    port,
    path: '/api/matters',
    headers: { ...bearer(ids.sessionToken), Connection: 'keep-alive' },
  })
  record(
    'response advertises keep-alive on HTTP/1.1',
    pipelined.status === 200 &&
      (pipelined.headers.connection === undefined ||
        pipelined.headers.connection === 'keep-alive'),
    `connection=${pipelined.headers.connection ?? 'absent (HTTP/1.1 default)'}`,
  )

  // ---- concurrent database transactions and rollback
  group('database')

  const matterCreates = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      fetch(
        `${origin}/api/matters`,
        json(
          {
            name: `gate-concurrent-${runTag}-${index}`,
            primaryJurisdiction: 'england_and_wales',
          },
          ids.sessionToken,
        ),
      ).then(async (response) => ({
        status: response.status,
        body: await response.json().catch(() => null),
      })),
    ),
  )
  record(
    'six concurrent matter creates all commit',
    matterCreates.every((entry) => entry.status === 201),
    `statuses=${matterCreates.map((entry) => entry.status).join(',')}`,
  )
  const createdIds = matterCreates
    .map((entry) => entry.body?.matter?.id)
    .filter(Boolean)
  const rowsAfter = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from matters
      where organisation_id = '${ids.organisationId}' and name like 'gate-concurrent-${runTag}-%'
    ) r`)
  record(
    'every committed create is visible in Postgres (no lost write)',
    rowsAfter[0]?.count === createdIds.length,
    `api=${createdIds.length} database=${rowsAfter[0]?.count}`,
  )

  // A failed request must leave no partial row. An invalid matter name is
  // refused by validation before any write; a failed extraction must roll back
  // the document/version/audit triple.
  const before = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from audit_logs where organisation_id = '${ids.organisationId}'
    ) r`)
  const rejected = await fetch(
    `${origin}/api/matters`,
    json(
      { name: '', primaryJurisdiction: 'england_and_wales' },
      ids.sessionToken,
    ),
  )
  const after = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from audit_logs where organisation_id = '${ids.organisationId}'
    ) r`)
  record(
    'a rejected write commits nothing (audit count unchanged)',
    rejected.status === 400 && before[0].count === after[0].count,
    `status=${rejected.status} auditBefore=${before[0].count} auditAfter=${after[0].count}`,
  )

  const badUploadBefore = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from matter_documents where matter_id = '${ids.matterId}'
    ) r`)
  const badUpload = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    {
      method: 'POST',
      headers: bearer(ids.sessionToken),
      body: (() => {
        const form = new FormData()
        form.set('filename', 'gate-invalid.docx')
        form.set('fileType', 'docx')
        form.set('sizeBytes', '100')
        form.set('contentSha256', 'not-a-sha')
        form.set(
          'file',
          new File([Buffer.from('not a zip at all')], 'gate-invalid.docx', {
            type: DOCX_CONTENT_TYPE,
          }),
        )
        return form
      })(),
    },
  )
  const badUploadAfter = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from matter_documents where matter_id = '${ids.matterId}'
    ) r`)
  record(
    'a failed extraction leaves no document row behind',
    badUpload.status >= 400 &&
      badUploadBefore[0].count === badUploadAfter[0].count,
    `status=${badUpload.status} before=${badUploadBefore[0].count} after=${badUploadAfter[0].count}`,
  )

  // better-auth clears several cookies on sign-out, which is the only
  // multi-`Set-Cookie` response this API produces without an email flow. The
  // session used is a disposable third one, so the measured sessions survive.
  group('auth cookies')

  const disposable = fixtureIds(`${runTag}x`)
  querier.exec(`
    insert into organisations (id, name) values ('${disposable.organisationId}', 'gate disposable');
    insert into users (id, name, email, "emailVerified", "organisationId", role)
      values ('${disposable.userId}', 'disposable', '${disposable.email}', true, '${disposable.organisationId}', 'owner');
    insert into sessions (id, "expiresAt", token, "userId", "userAgent")
      values ('${disposable.sessionId}', now() + interval '1 hour', '${disposable.sessionToken}', '${disposable.userId}', 'gate');`)

  const signedOut = await rawRequest({
    port,
    path: '/api/auth/sign-out',
    method: 'POST',
    headers: {
      ...bearer(disposable.sessionToken),
      'Content-Type': 'application/json',
    },
    body: Buffer.from('{}'),
  })
  const setCookies = signedOut.rawHeaders.filter(
    (value, index) =>
      signedOut.rawHeaders[index - 1]?.toLowerCase() === 'set-cookie',
  )
  record(
    'sign-out preserves multiple Set-Cookie headers as distinct lines',
    signedOut.status === 200 && setCookies.length >= 2,
    `status=${signedOut.status} setCookieLines=${setCookies.length}`,
  )
  record(
    'sign-out clears the session cookie with an expiring attribute',
    setCookies.some((value) =>
      /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(value),
    ),
    `setCookie=${setCookies.map((value) => value.slice(0, 60)).join(' | ') || 'none'}`,
  )
  const sessionRows = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from sessions where token = '${disposable.sessionToken}'
    ) r`)
  record(
    'sign-out deletes the session row',
    sessionRows[0]?.count === 0,
    `sessionRows=${sessionRows[0]?.count}`,
  )
  const signedOutAudit = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from audit_logs
      where organisation_id = '${disposable.organisationId}' and action = 'auth.sign_out'
    ) r`)
  record(
    'sign-out appends its audit row',
    signedOutAudit[0]?.count === 1,
    `authSignOutRows=${signedOutAudit[0]?.count}`,
  )

  // ---- expected headers, statuses, errors
  group('protocol')

  const health = await rawRequest({ port, path: '/api/health' })
  record(
    'health is 200 JSON with the provenance this checkout expects',
    health.status === 200 &&
      health.headers['content-type']?.startsWith('application/json') &&
      JSON.parse(health.body.toString('utf8')).provenance?.checkoutRoot ===
        WORKTREE,
    `status=${health.status} content-type=${health.headers['content-type']}`,
  )

  const notFound = await rawRequest({
    port,
    path: '/api/definitely-not-a-route',
  })
  record(
    'unknown route is 404, not 500',
    notFound.status === 404,
    `status=${notFound.status}`,
  )

  const badJson = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': 'application/json',
    },
    body: Buffer.from('{"filename": '),
  })
  record(
    'malformed JSON is 4xx, not 500',
    badJson.status >= 400 && badJson.status < 500,
    `status=${badJson.status}`,
  )

  const head = await rawRequest({ port, path: '/api/health', method: 'HEAD' })
  record(
    'HEAD /api/health has no body and a matching status',
    head.status === 200 && head.body.byteLength === 0,
    `status=${head.status} bytes=${head.body.byteLength}`,
  )

  const errorShape = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}`,
    headers: bearer('not-a-real-token'),
  })
  const errorBody = JSON.parse(errorShape.body.toString('utf8') || '{}')
  record(
    'error responses carry the contract error envelope',
    errorShape.status === 401 && typeof errorBody?.error?.code === 'string',
    `status=${errorShape.status} code=${errorBody?.error?.code ?? 'none'}`,
  )

  // ---- timeout behaviour
  group('timeouts')

  // Node's http server has headersTimeout/requestTimeout/keepAliveTimeout;
  // Bun.serve has a single idleTimeout. Both are observable, so they are
  // measured rather than read off the documentation. The 40 s cap here is
  // deliberately shorter than Node's defaults; `timeouts.mjs` repeats these
  // probes with a 100 s cap.
  const idle = await measureIdleKeepAlive({
    port,
    token: ids.sessionToken,
    capMs: 40_000,
  })
  record(
    'idle keep-alive socket is closed by the server',
    idle.closedMs !== null,
    `closed after ${idle.closedMs === null ? '>40s (cap)' : `${Math.round(idle.closedMs)}ms`}`,
    { observed: idle },
  )

  const halfHeader = await measureHalfHeader({ port, capMs: 40_000 })
  record(
    'a half-sent request header is closed by the server within 40s',
    halfHeader.closedMs !== null,
    `closed after ${halfHeader.closedMs === null ? '>40s (cap)' : `${Math.round(halfHeader.closedMs)}ms`}`,
    { observed: halfHeader },
  )
}

/**
 * SIGTERM while a request is in flight: the in-flight response must complete,
 * the process must exit 0, and the pool must be closed deliberately rather than
 * torn down with the process. Operates on the live server object, so it runs
 * last and replaces the ordinary stop.
 */
async function runShutdownGate({ server, port, ids, documentId, log }) {
  group('graceful shutdown')
  let inFlight = null
  const slow = new Promise((done) => {
    const started = performance.now()
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: `/api/documents/${documentId}/download`,
        headers: bearer(ids.sessionToken),
      },
      (response) => {
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          response.pause()
          // Slow enough that the response is still open when SIGTERM lands.
          setTimeout(() => response.resume(), 120)
        })
        response.on('end', () =>
          done({
            status: response.statusCode,
            bytes,
            ms: performance.now() - started,
          }),
        )
      },
    )
    request.on('error', (error) =>
      done({
        status: 0,
        bytes: 0,
        error: error.message,
        ms: performance.now() - started,
      }),
    )
    request.end()
    inFlight = request
  })

  await sleep(300)
  const signalledAt = performance.now()
  try {
    process.kill(-server.child.pid, 'SIGTERM')
  } catch {
    server.child.kill('SIGTERM')
  }
  const result = await slow
  const drained = await new Promise((done) => {
    const deadline = Date.now() + 12_000
    const tick = () => {
      if (server.child.exitCode !== null)
        return done({ code: server.child.exitCode })
      if (Date.now() > deadline) return done({ code: null })
      setTimeout(tick, 50)
    }
    tick()
  })
  server.stopped = true
  record(
    'in-flight request completes through SIGTERM',
    result.status === 200 && result.bytes > 0,
    `status=${result.status} bytes=${result.bytes} closed ${Math.round(performance.now() - signalledAt)}ms after signal`,
  )
  record(
    'process exits 0 after draining',
    drained.code === 0,
    `exitCode=${drained.code}`,
  )
  record(
    'database pool is closed deliberately on shutdown',
    log.join('').includes('drained and database pool closed'),
    log.join('').includes('drained and database pool closed')
      ? 'shutdown log line present'
      : 'shutdown log line absent',
  )
  const afterExit = await fetch(`http://127.0.0.1:${port}/api/health`)
    .then((response) => response.status)
    .catch(() => 'connection_refused')
  record(
    'the port is released (no lingering listener)',
    afterExit === 'connection_refused',
    `health after exit=${afterExit}`,
  )
  void inFlight
}

/** How long an idle keep-alive connection survives before the server closes it. */
function measureIdleKeepAlive({ port, token, capMs }) {
  return new Promise((done) => {
    const socket = new Socket()
    let started = 0
    socket.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET /api/matters HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nConnection: keep-alive\r\n\r\n`,
      )
    })
    socket.on('data', () => {
      if (started === 0) started = performance.now()
    })
    socket.on('close', () =>
      done({
        closedMs: started === 0 ? null : performance.now() - started,
        outcome: 'closed',
      }),
    )
    socket.on('error', () => {})
    setTimeout(() => {
      socket.destroy()
      done({ closedMs: null, outcome: 'still_open_at_cap' })
    }, capMs)
  })
}

/** How long a connection that sent only part of a request header survives. */
function measureHalfHeader({ port, capMs }) {
  return new Promise((done) => {
    const socket = new Socket()
    const started = performance.now()
    socket.connect(port, '127.0.0.1', () => {
      socket.write('GET /api/health HTTP/1.1\r\nHost: localhost\r\nX-Partial: ')
    })
    socket.on('data', () => {
      socket.destroy()
      done({ closedMs: performance.now() - started, outcome: 'answered' })
    })
    socket.on('close', () =>
      done({ closedMs: performance.now() - started, outcome: 'closed' }),
    )
    socket.on('error', () => {})
    setTimeout(() => {
      socket.destroy()
      done({ closedMs: null, outcome: 'still_open_at_cap' })
    }, capMs)
  })
}

/** POST a JSON body with Transfer-Encoding: chunked instead of a length. */
function chunkedJsonPost({ port, path, token, payload }) {
  return new Promise((done) => {
    const socket = new Socket()
    const started = performance.now()
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      done({ ...result, ms: Math.round(performance.now() - started) })
    }
    socket.connect(port, '127.0.0.1', () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\n` +
          `Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`,
      )
      const body = Buffer.from(payload, 'utf8')
      // Two chunks, so the decoder is exercised rather than a single write.
      const half = Math.ceil(body.length / 2)
      socket.write(`${half.toString(16)}\r\n`)
      socket.write(body.subarray(0, half))
      socket.write(`\r\n${(body.length - half).toString(16)}\r\n`)
      socket.write(body.subarray(half))
      socket.write('\r\n0\r\n\r\n')
    })
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      const statuses = [
        ...buffered.toString('latin1').matchAll(/HTTP\/1\.1 (\d{3})/g),
      ].map((match) => match[1])
      const last = statuses[statuses.length - 1]
      if (last && last !== '100')
        finish({ status: Number(last), usedChunkedEncoding: true })
    })
    socket.on('error', (error) =>
      finish({ status: 0, usedChunkedEncoding: true, error: error.message }),
    )
    setTimeout(
      () =>
        finish({
          status: 0,
          usedChunkedEncoding: true,
          error: 'client_timeout',
        }),
      20_000,
    )
  })
}

/**
 * A multipart upload that sends headers with `Expect: 100-continue` first and
 * only writes the body after the interim response. Bounded, because the failure
 * mode this checks for is a hang.
 */
function expectContinueUpload({ port, token, matterId, fixture }) {
  return new Promise((done) => {
    const boundary = `----obiterevalexpect${Date.now()}`
    const body = multipartBody({
      boundary,
      fields: {
        filename: fixtureFilename(fixture),
        fileType: 'docx',
        sizeBytes: String(fixture.bytes),
        contentSha256: createHash('sha256')
          .update(fixture.content)
          .digest('hex'),
      },
      file: {
        filename: fixtureFilename(fixture),
        contentType: DOCX_CONTENT_TYPE,
        content: fixture.content,
      },
    })
    const socket = new Socket()
    const started = performance.now()
    let interim = false
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      done({ ...result, ms: performance.now() - started })
    }
    socket.connect(port, '127.0.0.1', () => {
      socket.write(
        `POST /api/matters/${matterId}/documents HTTP/1.1\r\n` +
          `Host: localhost\r\nAuthorization: Bearer ${token}\r\n` +
          `Content-Type: multipart/form-data; boundary=${boundary}\r\n` +
          `Content-Length: ${body.byteLength}\r\nExpect: 100-continue\r\n\r\n`,
      )
      setTimeout(() => {
        if (!interim) socket.write(body)
      }, 250)
    })
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      const text = buffered.toString('latin1')
      if (!interim && text.includes('100 Continue')) {
        interim = true
        socket.write(body)
      }
      // The interim `100 Continue` line stays in the buffer, so take the last
      // status line rather than the first.
      const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(
        (m) => m[1],
      )
      const last = statuses[statuses.length - 1]
      if (last && last !== '100') finish({ interim, status: Number(last) })
    })
    socket.on('error', (error) =>
      finish({ interim, status: 0, error: error.message }),
    )
    setTimeout(
      () => finish({ interim, status: 0, error: 'client_timeout' }),
      15_000,
    )
  })
}

/** A ZIP with a huge uncompressed size behind a tiny deflate stream. */
function makeZipBomb() {
  // A minimal stored-then-deflated DOCX-shaped zip: one entry declaring a very
  // large uncompressed size with a highly compressible payload. The ooxml
  // limits refuse it on the declared ratio before inflating.
  const name = Buffer.from('[Content_Types].xml')
  const payload = Buffer.alloc(2 * 1024 * 1024, 0x41)
  const deflated = deflateRawSync(payload)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(0, 14)
  local.writeUInt32LE(deflated.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(deflated.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(name.length, 28)
  const centralOffset = local.length + name.length + deflated.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, name, deflated, central, name, end])
}

/**
 * Sign a session token the way better-auth does, using better-auth's own
 * published helper rather than reimplementing the HMAC.
 */
async function signSessionCookie(token) {
  const { createRequire } = await import('node:module')
  const require = createRequire(join(API_DIR, 'package.json'))
  const crypto = require('better-auth/crypto')
  return `${token}.${await crypto.makeSignature(token, SECRET)}`
}

// ---------------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = await mkdtemp(join(tmpdir(), 'bun-eval-gates-'))
  const envText = await readFile(ENV_FILE, 'utf8')
  const databaseUrl = readEnvAssignment(envText, 'DATABASE_URL', process.env)
  const databaseName = databaseNameFromUrl(databaseUrl)
  if (databaseName !== OWNED_DATABASE)
    throw new Error(`refusing to run: DATABASE_URL names "${databaseName}"`)
  const querier = createQuerier({ databaseUrl })
  const fixtures = await buildFixtures({
    sizes: ['small', 'medium'],
    outDir: join(outDir, 'fixtures'),
  })

  const runTag = newRunTag()
  const ids = fixtureIds(runTag)

  const server = await startServer({
    runtime: args.runtime,
    port: args.port,
    logPath: join(outDir, `${args.runtime}.log`),
  })
  const report = {
    runtime: args.runtime,
    startedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: WORKTREE,
      encoding: 'utf8',
    }).trim(),
    node: process.version,
    bun: execFileSync(BUN_BIN, ['--version'], { encoding: 'utf8' }).trim(),
    readyMs: Math.round(server.readyMs),
    checks: [],
  }
  try {
    Object.assign(
      ids,
      await provisionFixtures({
        target: { apiOrigin: server.origin },
        querier,
        ids,
      }),
    )

    // The other tenant needs one ready document of its own, so the
    // cross-tenant document refusal is proved against a row that exists.
    const otherUpload = new FormData()
    otherUpload.set('filename', 'other-tenant.docx')
    otherUpload.set('fileType', 'docx')
    otherUpload.set('sizeBytes', String(fixtures[0].bytes))
    otherUpload.set(
      'contentSha256',
      createHash('sha256').update(fixtures[0].content).digest('hex'),
    )
    otherUpload.set(
      'file',
      new File([fixtures[0].content], 'other-tenant.docx', {
        type: DOCX_CONTENT_TYPE,
      }),
    )
    const otherUploadResponse = await fetch(
      `${server.origin}/api/matters/${ids.otherMatterId}/documents`,
      {
        method: 'POST',
        headers: bearer(ids.otherSessionToken),
        body: otherUpload,
      },
    )
    if (otherUploadResponse.status !== 201)
      throw new Error(
        `seeding the other tenant failed: ${otherUploadResponse.status} ${await otherUploadResponse.text()}`,
      )

    await runGates({
      origin: server.origin,
      port: args.port,
      ids,
      fixtures,
      querier,
      runTag,
    })
    await runShutdownGate({
      server,
      port: args.port,
      ids,
      documentId: lastUploadedDocumentId,
      log: server.log,
    })
  } finally {
    report.checks = checks
    report.passed = checks.filter((check) => check.ok).length
    report.failed = checks.filter((check) => !check.ok).length
    report.serverLog = server.log.slice(-30)
    report.finishedAt = new Date().toISOString()
    await writeFile(args.out, JSON.stringify(report, null, 2), 'utf8')
    if (!server.stopped) await stopServer(server)
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  }
  console.log(
    `\n${args.runtime}: ${report.passed} passed, ${report.failed} failed -> ${args.out}`,
  )
  if (report.failed > 0) process.exitCode = 1
}

await main()
