/*
 * Regression for the production web image's stylesheet 404: SSR pages named a
 * styles-*.css that dist/client neither contained nor served.
 *
 * The defect only appears where nothing ignores the build output. The Docker
 * context ships no .gitignore and no .git, so Tailwind's automatic source
 * detection rescanned the dist/ that the client build pass had just written
 * when the SSR pass compiled its own copy of the stylesheet. The two passes
 * hashed differently, the SSR manifest carried the second hash, and only the
 * first file was ever emitted.
 *
 * This test therefore builds the real artifact in a mirrored tree with no
 * .gitignore and no .git (the image build's condition), serves it with the
 * production host (serve.mjs under bun), and asserts from live SSR responses
 * that every stylesheet the principal routes name exists under dist/client and
 * serves HTTP 200 with a text/css body. When the two passes disagree the
 * request 404s here exactly as it did in the image. It also pins the cache
 * policy (SSR stays private/no-store, hashed stylesheets stay immutable) and
 * path safety (traversal never serves files from disk) on the same server.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { connect, createServer } from 'node:net'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  symlink,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMMUTABLE_CACHE_CONTROL } from './http-policy.mjs'

const repoRoot = join(import.meta.dirname, '..', '..')

/** Routes the production host must answer with a styled page. */
const ROUTES = ['/', '/sign-in', '/search', '/settings']

/**
 * Never mirrored into the sandbox: build output and caches (the image context
 * excludes the same), VCS metadata, and environment files (the image ships
 * none; a lane .env must not configure a test build either).
 */
const SKIP = new Set([
  '.git',
  '.tanstack',
  '.bun',
  '.vite',
  'coverage',
  'dist',
  'playwright-report',
  'test-results',
])
const skipEntry = (name) => SKIP.has(name) || name.startsWith('.env')

/**
 * Copy src into dest preserving symlinks verbatim. node:fs.cp is not usable
 * here: it rewrites a relative symlink into an absolute one pointing back at
 * the source tree, which would silently resolve packages outside the sandbox.
 */
async function mirror(src, dest) {
  await mkdir(dest, { recursive: true })
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (skipEntry(entry.name)) continue
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isSymbolicLink()) await symlink(await readlink(from), to)
    else if (entry.isDirectory()) await mirror(from, to)
    else await copyFile(from, to)
  }
}

/**
 * Root files only: workspaces are resolved from package.json, and the tree
 * deliberately omits .gitignore and .env files, which the image context never
 * ships.
 */
const ROOT_FILES = [
  'package.json',
  'bun.lock',
  'bunfig.toml',
  'tsconfig.base.json',
  'tsconfig.json',
]

function run(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (out += chunk))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(`${cmd} ${args.join(' ')} timed out\n${out.slice(-4000)}`),
      )
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else
        reject(
          new Error(
            `${cmd} ${args.join(' ')} exited ${code}\n${out.slice(-4000)}`,
          ),
        )
    })
  })
}

/** Production build environment: no NODE_ENV (the config refuses a dev build). */
function buildEnv() {
  const env = { ...process.env, CI: '1' }
  delete env.NODE_ENV
  try {
    env.OBITER_BUILD_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    const dirty =
      execFileSync('git', ['status', '--porcelain'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).length > 0
    env.OBITER_BUILD_DIRTY = dirty ? '1' : '0'
  } catch {
    // No git in the environment: the marker records null, as an ad-hoc build does.
  }
  return env
}

function stylesheetHrefs(html) {
  const hrefs = []
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    if (!/rel="stylesheet"/.test(tag)) continue
    const href = tag.match(/href="([^"]+)"/)?.[1]
    if (href) hrefs.push(href)
  }
  return hrefs
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** Raw request so the client cannot normalise dot segments before the wire. */
function rawRequest(port, path) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let received = ''
    socket.setTimeout(10_000, () => socket.destroy(new Error('socket timeout')))
    socket.on('error', reject)
    socket.on('data', (chunk) => (received += chunk))
    socket.on('end', () => {
      const split = received.indexOf('\r\n\r\n')
      const head = split === -1 ? received : received.slice(0, split)
      const body = split === -1 ? '' : received.slice(split + 4)
      const status = Number(head.match(/^HTTP\/1\.[01] (\d{3})/)?.[1])
      const contentType = head.match(/^content-type:\s*(.+)$/im)?.[1]?.trim()
      resolve({ status, contentType, body })
    })
    socket.on('close', () =>
      resolve({ status: 0, contentType: '', body: received }),
    )
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
        'Accept-Encoding: identity\r\nConnection: close\r\n\r\n',
    )
  })
}

let sandbox
let server // child process running the production host
let port

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM')
    await new Promise((done) => {
      server.once('exit', done)
      setTimeout(() => {
        server.kill('SIGKILL')
        done()
      }, 5_000)
    })
  }
  if (sandbox) await rm(sandbox, { recursive: true, force: true })
})

test(
  'builds the real web artifact without .gitignore or .git (the image build condition)',
  { timeout: 300_000 },
  async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'obiter-stylesheet-'))
    await mirror(join(repoRoot, 'packages'), join(sandbox, 'packages'))
    await mirror(join(repoRoot, 'apps', 'web'), join(sandbox, 'apps', 'web'))
    // Root node_modules as links: bun's isolated layout stores everything
    // behind relative symlinks, so the copy stays inside the sandbox except
    // the package store, which is shared deliberately (dependencies are not
    // under test and re-installing would take minutes).
    await mirror(join(repoRoot, 'node_modules'), join(sandbox, 'node_modules'))
    await symlink(
      join(repoRoot, 'node_modules', '.bun'),
      join(sandbox, 'node_modules', '.bun'),
      'dir',
    )
    for (const name of ROOT_FILES) {
      await copyFile(join(repoRoot, name), join(sandbox, name))
    }
    const buildOutput = await run(
      'bun',
      ['--bun', 'run', '--filter', '@obiter/web', 'build'],
      { cwd: sandbox, env: buildEnv(), timeoutMs: 280_000 },
    )
    assert.match(buildOutput, /build provenance/)
  },
)

test(
  'every stylesheet an SSR response names exists and serves real CSS',
  { timeout: 120_000 },
  async () => {
    assert.ok(sandbox, 'the build test must run first')
    port = await freePort()
    server = spawn('bun', ['serve.mjs'], {
      cwd: join(sandbox, 'apps', 'web'),
      env: {
        ...buildEnv(),
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let serverLog = ''
    server.stdout.on('data', (chunk) => (serverLog += chunk))
    server.stderr.on('data', (chunk) => (serverLog += chunk))

    const origin = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 60_000
    for (;;) {
      if (server.exitCode !== null) {
        assert.fail(`serve.mjs exited early:\n${serverLog}`)
      }
      try {
        const probe = await fetch(`${origin}/sign-in`)
        if (probe.status > 0) break
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline)
        assert.fail(`serve.mjs never became ready:\n${serverLog}`)
      await new Promise((done) => setTimeout(done, 250))
    }

    const clientDir = join(sandbox, 'apps', 'web', 'dist', 'client')
    const refs = new Set()

    for (const route of ROUTES) {
      const response = await fetch(origin + route)
      const contentType = response.headers.get('content-type') ?? ''
      assert.match(contentType, /text\/html/, `${route} must answer with HTML`)
      const cacheControl = response.headers.get('cache-control') ?? ''
      assert.ok(
        cacheControl.includes('private') && cacheControl.includes('no-store'),
        `${route} must stay private, no-store (got "${cacheControl}")`,
      )
      const html = await response.text()
      const found = stylesheetHrefs(html)
      assert.ok(
        found.length > 0,
        `${route} must name a stylesheet; none found in the SSR response`,
      )
      for (const href of found) refs.add(href)
    }

    assert.ok(refs.size > 0, 'at least one stylesheet reference is required')
    for (const href of refs) {
      assert.ok(
        href.startsWith('/assets/') && href.endsWith('.css'),
        `unexpected stylesheet URL shape: ${href}`,
      )
      // Ownership: the named file must be emitted into the served client tree.
      const emitted = await stat(join(clientDir, href))
      assert.ok(emitted.isFile(), `${href} must exist in dist/client`)

      const get = await fetch(origin + href)
      assert.equal(get.status, 200, `${href} must serve HTTP 200`)
      assert.match(
        get.headers.get('content-type') ?? '',
        /^text\/css/,
        `${href} must serve text/css`,
      )
      assert.equal(
        get.headers.get('cache-control'),
        IMMUTABLE_CACHE_CONTROL,
        `${href} must keep immutable caching for hashed assets`,
      )
      const body = await get.text()
      assert.ok(
        body.length > 0 && body.includes('{'),
        `${href} must serve CSS rules`,
      )

      const head = await fetch(origin + href, { method: 'HEAD' })
      assert.equal(head.status, 200, `HEAD ${href} must serve HTTP 200`)
      assert.match(
        head.headers.get('content-type') ?? '',
        /^text\/css/,
        `HEAD ${href} must serve text/css`,
      )
    }
  },
)

test(
  'traversal requests never serve files from disk',
  { timeout: 30_000 },
  async () => {
    assert.ok(port, 'the server test must run first')
    for (const path of [
      '/assets/../../../package.json',
      '/assets/../../../bun.lock',
      '/assets/%2e%2e/%2e%2e/bun.lock',
    ]) {
      const { status, contentType, body } = await rawRequest(port, path)
      assert.ok(
        !(status === 200 && !(contentType ?? '').startsWith('text/html')),
        `${path} must not serve a raw file (got ${status} ${contentType})`,
      )
      assert.ok(
        !body.includes('lockfileVersion'),
        `${path} must not leak bun.lock contents`,
      )
    }
  },
)
