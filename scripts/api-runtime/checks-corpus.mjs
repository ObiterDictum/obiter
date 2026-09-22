/*
 * Corpus-mode boots for the runtime harness.
 *
 * The main run sets no corpus variables: that is the compatibility mode, where
 * the corpus is the application database, and its health report is asserted
 * there. These boots prove the other configured modes on the same adapter,
 * because the mode follows configuration provenance rather than URL equality:
 * pointing the corpus variables at this task's own database must still report
 * a separate, non-colocated corpus, and only a process given the writer
 * variable may report a writable one.
 *
 * The corpus URLs always name this task's database (the harness's own guard
 * already refused anything else), so a boot never reads or writes a shared
 * corpus, and the writer boot's capability lands on the task database only.
 * Routing and no-fallback proofs live in the unit suites (database-pools,
 * env-corpus, proxy-routes); what is asserted here is that each adapter boots
 * each mode, serves through it, and reports it identically.
 */
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
  databaseUrl,
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
        databaseUrl,
        storageRoot,
        rampartCacheDir,
      }),
      ...extraEnvironment,
    },
  })
  return server
}

/**
 * Start one adapter in the given corpus configuration, assert the mode it
 * reports, prove a session through it, and stop it. Every boot is stopped even
 * when its check fails, so a failed mode cannot leave a process behind.
 */
async function checkMode({
  name,
  expectedCorpus,
  runtime,
  worktreeRoot,
  bunBin,
  databaseUrl,
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
    databaseUrl,
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

/**
 * A writer without a reader must refuse to boot on both adapters: the
 * forbidden read-application-write-corpus topology cannot be constructed, and
 * the refusal is the environment boundary speaking, not a crash.
 */
async function checkWriterWithoutReader({
  runtime,
  worktreeRoot,
  bunBin,
  databaseUrl,
  storageRoot,
  rampartCacheDir,
  recorder,
}) {
  const server = await bootWith({
    runtime,
    worktreeRoot,
    bunBin,
    databaseUrl,
    storageRoot,
    rampartCacheDir,
    extraEnvironment: { CORPUS_WRITE_DATABASE_URL: databaseUrl },
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
  databaseUrl,
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
    databaseUrl,
    storageRoot,
    rampartCacheDir,
    ids,
    recorder,
  }

  await checkMode({
    ...shared,
    name: 'an explicit read-only corpus reports itself and serves',
    expectedCorpus: { colocated: false, readOnly: true },
    extraEnvironment: { CORPUS_DATABASE_URL: databaseUrl },
  })
  await checkMode({
    ...shared,
    name: 'a dedicated corpus writer reports itself and serves',
    expectedCorpus: { colocated: false, readOnly: false },
    extraEnvironment: {
      CORPUS_DATABASE_URL: databaseUrl,
      CORPUS_WRITE_DATABASE_URL: databaseUrl,
    },
  })
  await checkWriterWithoutReader(shared)
}
