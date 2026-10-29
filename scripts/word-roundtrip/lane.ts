import { resolveLocalEnvFile } from '../../packages/config/src/local-env.mjs'
import {
  headSha,
  SHARED_API_PORT,
  SHARED_WEB_PORT,
  verifyServedCheckout,
  WORKTREE_ROOT,
  type LaneFetch,
} from '../../apps/web/lane-target.mjs'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const SHARED_DATABASE = 'obiter'

export type LaneContext = {
  apiOrigin: string
  webOrigin: string
  databaseName: string
  headSha: string
  api: {
    commitSha: string | null
    checkoutRoot: string | null
  }
}

type ServedProvenance = {
  commitSha?: string
  checkoutRoot?: string
  envFile?: string | null
  databaseName?: string | null
}

type ServedHealth = {
  provenance?: ServedProvenance
}

export function isolatedOrigin(raw: string, label: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `${label} origin "${raw}" is not a valid URL. Pass a loopback origin ` +
        `like http://127.0.0.1:8797.`,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `${label} origin "${raw}" is not an http(s) origin. The harness only ` +
        'talks to a local test API and web server over http.',
    )
  }

  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80
  if (port === SHARED_API_PORT || port === SHARED_WEB_PORT) {
    throw new Error(
      `${label} origin "${raw}" is the shared dev stack (port ${port}), which ` +
        'this machine reserves for obiter-live. The harness refuses it: its ' +
        `synthetic accounts belong in a task-owned lane, never shared data. ` +
        "Point the flag at this run's isolated server.",
    )
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `${label} origin "${raw}" is not a loopback address. The harness only ` +
        'runs against a local, isolated stack; refusing a remote host that ' +
        'could be a shared deployment.',
    )
  }
  return url
}

export function testDatabaseName(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    throw new Error(
      '--db-name is required: the harness verifies its synthetic user with ' +
        'psql and writes documents through the API, so it must name the ' +
        "isolated lane's test database (for example obiter_e0_test).",
    )
  }
  if (raw === SHARED_DATABASE) {
    throw new Error(
      `--db-name points at the shared dev database \`${SHARED_DATABASE}\`. ` +
        'The harness refuses it: synthetic word-rt-* accounts belong in a ' +
        'task-owned database, never shared data.',
    )
  }
  if (!raw.endsWith('_test')) {
    throw new Error(
      `--db-name must name a test database ending in "_test"; got "${raw}".`,
    )
  }
  return raw
}

async function servedApiProvenance(
  apiOrigin: string,
  fetchImpl: LaneFetch,
): Promise<ServedProvenance | undefined> {
  let body: unknown
  try {
    const response = await fetchImpl(`${apiOrigin}/api/health`)
    if (!response.ok) throw new Error(`status ${response.status}`)
    body = await response.json()
  } catch {
    throw new Error(
      `The API at ${apiOrigin} did not answer /api/health with lane ` +
        'provenance. verifyServedCheckout already succeeded, so the API ' +
        'dropped between checks — restart the lane.',
    )
  }
  if (typeof body !== 'object' || body === null) return undefined
  // SAFETY: every ServedProvenance field is optional and read through
  const provenance = (body as ServedHealth).provenance
  return typeof provenance === 'object' && provenance !== null
    ? provenance
    : undefined
}

export async function resolveLane(
  input: {
    api: string
    web: string
    dbName: string | undefined
  },
  deps: { fetchImpl?: LaneFetch } = {},
): Promise<LaneContext> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const api = isolatedOrigin(input.api, 'API')
  const web = isolatedOrigin(input.web, 'Web')
  const databaseName = testDatabaseName(input.dbName)

  const head = headSha(WORKTREE_ROOT)
  if (!head) {
    throw new Error(
      'The harness must run inside the git checkout so API provenance can be ' +
        'compared with HEAD.',
    )
  }
  await verifyServedCheckout(
    {
      envFile: resolveLocalEnvFile(WORKTREE_ROOT),
      webPort: Number(web.port || (web.protocol === 'https:' ? 443 : 80)),
      apiPort: Number(api.port || (api.protocol === 'https:' ? 443 : 80)),
      webOrigin: web.origin,
      apiOrigin: api.origin,
    },
    { worktreeRoot: WORKTREE_ROOT, headSha: head, fetchImpl },
  )

  const provenance = await servedApiProvenance(api.origin, fetchImpl)
  const served =
    typeof provenance?.databaseName === 'string'
      ? provenance.databaseName
      : null
  if (served !== databaseName) {
    throw new Error(
      `The API at ${api.origin} reports it is bound to database ` +
        `"${served ?? 'unknown'}", not --db-name "${databaseName}". The ` +
        'psql verification would update a database the API never reads, or ' +
        'the API would write a database the check did not clear. Restart the ' +
        'lane on the same *_test database the flag names.',
    )
  }

  return {
    apiOrigin: api.origin,
    webOrigin: web.origin,
    databaseName,
    headSha: head,
    api: {
      commitSha:
        typeof provenance?.commitSha === 'string' ? provenance.commitSha : null,
      checkoutRoot:
        typeof provenance?.checkoutRoot === 'string'
          ? provenance.checkoutRoot
          : null,
    },
  }
}
