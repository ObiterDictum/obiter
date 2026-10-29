import { childEnvironment } from './config.mjs'
import { proveSession } from './fixtures.mjs'
import {
  LifecycleError,
  allocatePort,
  startServer,
  stopServer,
  waitForHealth,
} from './lifecycle.mjs'

async function bootWith({
  runtime,
  worktreeRoot,
  bunBin,
  target,
  storageRoot,
  rampartCacheDir,
  extraEnvironment,
}) {
  const port = await allocatePort()
  const server = startServer({
    runtime,
    worktreeRoot,
    port,
    bunBin,
    environment: {
      ...childEnvironment({
        port,
        target,
        storageRoot,
        rampartCacheDir,
      }),
      ...extraEnvironment,
    },
  })
  return server
}

async function checkMode({
  name,
  expectedCorpus,
  runtime,
  worktreeRoot,
  bunBin,
  target,
  storageRoot,
  rampartCacheDir,
  extraEnvironment,
  ids,
  recorder,
}) {
  const server = await bootWith({
    runtime,
    worktreeRoot,
    bunBin,
    target,
    storageRoot,
    rampartCacheDir,
    extraEnvironment,
  })
  try {
    const health = await waitForHealth(server, { expectedRuntime: runtime })
    const corpus = health.corpus ?? null
    const reported =
      corpus?.colocated === expectedCorpus.colocated &&
      corpus?.readOnly === expectedCorpus.readOnly &&
      !JSON.stringify(health).includes('postgres://')
    await proveSession({ origin: server.origin, ids })
    recorder.record(
      name,
      reported,
      `corpus=${JSON.stringify(corpus)} expected=${JSON.stringify(expectedCorpus)}`,
      { corpus },
    )
  } finally {
    await stopServer(server)
  }
}

async function checkWriterWithoutReader({
  runtime,
  worktreeRoot,
  bunBin,
  target,
  storageRoot,
  rampartCacheDir,
  recorder,
}) {
  const server = await bootWith({
    runtime,
    worktreeRoot,
    bunBin,
    target,
    storageRoot,
    rampartCacheDir,
    extraEnvironment: { CORPUS_WRITE_DATABASE_URL: target.url },
  })
  try {
    const deadline = Date.now() + 30_000
    while (server.child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const log = server.lines.map((entry) => entry.line).join('\n')
    recorder.record(
      'a corpus writer without a reader refuses to boot',
      server.child.exitCode === 1 &&
        log.includes('CORPUS_WRITE_DATABASE_URL requires CORPUS_DATABASE_URL'),
      `exitCode=${server.child.exitCode ?? 'running'} refusalLogged=${log.includes('CORPUS_WRITE_DATABASE_URL requires CORPUS_DATABASE_URL')}`,
    )
    if (server.child.exitCode === null) {
      throw new LifecycleError(
        'corpus_refusal_timeout',
        `${server.runtime} did not refuse a corpus writer without a reader.\n${log}`,
      )
    }
  } finally {
    if (server.child.exitCode === null) await stopServer(server)
  }
}

export async function runCorpusModeChecks({
  runtime,
  worktreeRoot,
  bunBin,
  target,
  storageRoot,
  rampartCacheDir,
  ids,
  recorder,
}) {
  recorder.group('corpus modes')
  const shared = {
    runtime,
    worktreeRoot,
    bunBin,
    target,
    storageRoot,
    rampartCacheDir,
    ids,
    recorder,
  }

  await checkMode({
    ...shared,
    name: 'an explicit read-only corpus reports itself and serves',
    expectedCorpus: { colocated: false, readOnly: true },
    extraEnvironment: { CORPUS_DATABASE_URL: target.url },
  })
  await checkMode({
    ...shared,
    name: 'a dedicated corpus writer reports itself and serves',
    expectedCorpus: { colocated: false, readOnly: false },
    extraEnvironment: {
      CORPUS_DATABASE_URL: target.url,
      CORPUS_WRITE_DATABASE_URL: target.url,
    },
  })
  await checkWriterWithoutReader(shared)
}
