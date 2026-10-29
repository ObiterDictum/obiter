#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveDatabaseTarget } from '../api-runtime/database-target.mjs'
import {
  fixtureIds,
  newRunTag,
  provisionSql,
} from '../api-runtime/fixtures.mjs'
import { createQuerier } from '../load/psql.mjs'
import { runThroughProxyChecks, runTimeoutControlChecks } from './checks.mjs'
import {
  DockerError,
  containerExec,
  containerExists,
  containerExitCode,
  containerLogs,
  containerRunning,
  imageDigest,
  imageExists,
  imageRevision,
  networkCreate,
  networkExists,
  networkRemove,
  removeContainer,
  signalContainer,
  startContainer,
  waitFor,
  waitForContainerExit,
} from './docker.mjs'
import * as proxy from './proxy.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ENTRYPOINTS_FILE = join(ROOT, 'infra/traefik/entrypoints.yml')
const DOCX_FILE = join(
  ROOT,
  'services/api/test-fixtures/upload-corpus/letter-plain.docx',
)

const TRAEFIK_IMAGE = 'traefik:v3.6.25'
const TRAEFIK_DIGEST =
  'sha256:31267173a15b4944e797a76ffd9c419707c8d8b32fe5b610f80cd0cfa05f372d'
const POSTGRES_IMAGE = 'postgres:16-alpine'
const ORIGIN_IMAGE = 'node:24.19.0-slim'

const DB_NAME = 'obiter_api_ingress'
const DB_PASSWORD = 'obiter'
const API_PORT = 8787
const ORIGIN_PORT = 8788
const LARGE_TXT_BYTES = 16 * 1024 * 1024

function usage() {
  console.log(`Usage: bun scripts/api-ingress/ingress.mjs [options]

  --bun-image <ref>     Bun API image (default obiter-api-bun:ingress)
  --node-image <ref>    Node rollback image (default obiter-api-node:ingress)
  --json-out <path>     write the check report as JSON
  --keep                leave containers running for inspection
  --verbose             set the local Traefik log level to DEBUG
`)
}

function parseArgs(argv) {
  const args = {
    bunImage: 'obiter-api-bun:ingress',
    nodeImage: 'obiter-api-node:ingress',
    jsonOut: null,
    keep: false,
    verbose: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split('=')
    const value = () => inline ?? argv[++index]
    switch (flag) {
      case '--bun-image':
        args.bunImage = value()
        break
      case '--node-image':
        args.nodeImage = value()
        break
      case '--json-out':
        args.jsonOut = value()
        break
      case '--keep':
        args.keep = true
        break
      case '--verbose':
        args.verbose = true
        break
      case '--help':
        usage()
        process.exit(0)
      default:
        throw new Error(`Unknown argument "${flag}".`)
    }
  }
  return args
}

function recorder() {
  const checks = []
  let group = 'setup'
  return {
    group(name) {
      group = name
    },
    record(name, ok, detail) {
      checks.push({ group, name, ok: Boolean(ok), detail })
      console.log(`${ok ? 'PASS' : 'FAIL'} [${group}] ${name} — ${detail}`)
    },
    checks,
    summary() {
      const failed = checks.filter((check) => !check.ok)
      return {
        passed: checks.length - failed.length,
        total: checks.length,
        failed: failed.map((check) => `${check.group}/${check.name}`),
      }
    },
  }
}

export async function teardownResources({
  resources,
  scratch,
  exists,
  removeContainer: removeContainerFn,
  networkRemove: networkRemoveFn,
  removeScratch,
}) {
  const failures = []
  for (const resource of [...resources].reverse()) {
    if (!exists(resource)) continue
    try {
      if (resource.type === 'container') removeContainerFn(resource.name)
      else networkRemoveFn(resource.name)
    } catch (error) {
      failures.push(`${resource.type} ${resource.name}: ${error.message}`)
    }
  }
  try {
    await removeScratch(scratch)
  } catch (error) {
    failures.push(`scratch ${scratch}: ${error.message}`)
  }
  return failures
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = recorder()
  const tag = `bi${randomBytes(3).toString('hex')}`
  const scratch = join(tmpdir(), `obiter-api-ingress-${tag}`)
  const dynamicDir = join(scratch, 'dynamic')
  const dynamicPath = join(dynamicDir, 'dyn.yml')
  const network = `obiter-ingress-${tag}`
  const names = {
    postgres: `ingress-pg-${tag}`,
    traefik: `ingress-traefik-${tag}`,
    traefikShort: `ingress-traefik-short-${tag}`,
    origin: `ingress-origin-${tag}`,
    bun: `ingress-bun-${tag}`,
    node: `ingress-node-${tag}`,
  }
  const created = []
  const startTracked = (options) => {
    created.push({ type: 'container', name: options.name })
    return startContainer(options)
  }
  let jsonReport = null
  let teardownFailures = []

  try {
    await mkdir(dynamicDir, { recursive: true })

    report.group('preconditions')
    for (const image of [args.bunImage, args.nodeImage]) {
      if (!imageExists(image)) {
        throw new DockerError(
          'image_missing',
          `Image ${image} is not present. Build both targets from the repo root:\n` +
            `  docker build -f services/api/Dockerfile -t ${args.bunImage} \\\n` +
            `    --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" .\n` +
            `  docker build -f services/api/Dockerfile --target runtime-node -t ${args.nodeImage} \\\n` +
            `    --build-arg OBITER_BUILD_COMMIT="$(git rev-parse HEAD)" .`,
        )
      }
    }
    const bunRevision = imageRevision(args.bunImage)
    const nodeRevision = imageRevision(args.nodeImage)
    const traefikDigest = imageDigest(TRAEFIK_IMAGE)
    report.record(
      'both API images name the same product commit',
      Boolean(bunRevision) && bunRevision === nodeRevision,
      `bun=${bunRevision ?? 'none'} node=${nodeRevision ?? 'none'}`,
    )
    report.record(
      'the Traefik image matches the pinned digest',
      traefikDigest !== null &&
        traefikDigest.endsWith(TRAEFIK_DIGEST.replace('sha256:', '')),
      traefikDigest ??
        'no RepoDigests on the local image; the pin cannot be verified',
    )

    const entrypointsYaml = await readFile(ENTRYPOINTS_FILE, 'utf8')
    const docx = await readFile(DOCX_FILE)
    const largeText = proxy.syntheticText(LARGE_TXT_BYTES)

    report.group('disposable stack')
    networkCreate(network)
    created.push({ type: 'network', name: network })

    const postgresPort = await proxy.freePort()
    startTracked({
      name: names.postgres,
      image: POSTGRES_IMAGE,
      network,
      aliases: ['pg'],
      env: {
        POSTGRES_USER: 'obiter',
        POSTGRES_PASSWORD: DB_PASSWORD,
        POSTGRES_DB: DB_NAME,
      },
      ports: [`127.0.0.1:${postgresPort}:5432`],
    })
    await waitFor(
      () => {
        try {
          return (
            containerExec(names.postgres, [
              'pg_isready',
              '-U',
              'obiter',
              '-d',
              DB_NAME,
            ]).includes('accepting connections') || null
          )
        } catch {
          return null
        }
      },
      { timeoutMs: 60_000, label: 'postgres ready' },
    )
    report.record(
      'task-owned postgres is accepting connections',
      true,
      `port ${postgresPort}`,
    )

    const traefikPort = await proxy.freePort()
    await writeFile(
      join(scratch, 'traefik.yml'),
      proxy.staticConfig(entrypointsYaml, { debug: args.verbose }),
    )
    await writeFile(
      dynamicPath,
      proxy.dynamicConfig('api-bun', {
        apiPort: API_PORT,
        originPort: ORIGIN_PORT,
      }),
    )
    startTracked({
      name: names.traefik,
      image: TRAEFIK_IMAGE,
      network,
      ports: [`127.0.0.1:${traefikPort}:80`],
      mounts: [
        `${join(scratch, 'traefik.yml')}:/etc/traefik/traefik.yml:ro`,
        `${dynamicDir}:${proxy.DYNAMIC_DIR}`,
      ],
      cmd: ['--configFile=/etc/traefik/traefik.yml'],
    })

    startTracked({
      name: names.origin,
      image: ORIGIN_IMAGE,
      network,
      aliases: ['origin'],
      env: { PORT: String(ORIGIN_PORT) },
      mounts: [
        `${join(ROOT, 'scripts/api-ingress/origin.mjs')}:/origin.mjs:ro`,
      ],
      cmd: ['node', '/origin.mjs'],
    })

    const apiEnvironment = {
      NODE_ENV: 'production',
      PORT: String(API_PORT),
      DATABASE_URL: `postgres://obiter:${DB_PASSWORD}@pg:5432/${DB_NAME}`,
      BETTER_AUTH_SECRET: 'obiter-api-ingress-secret-0123456789abcdef',
      BETTER_AUTH_URL: `http://${proxy.API_HOST}`,
      OBITER_WEB_ORIGIN: `http://${proxy.API_HOST}`,
      OBITER_RESEND_API_KEY: 'obiter-api-ingress-resend-key-0123456789',
      MEILISEARCH_HOST: 'http://meili.invalid:7700',
      MEILISEARCH_SEARCH_API_KEY: 'obiter-api-ingress-meili-key-0123456789',
      MEILISEARCH_ADMIN_API_KEY: 'obiter-api-ingress-meili-key-0123456789',
      LEGAL_AUTHORITIES_INDEX: 'legal_authorities',
      OBITER_REDACTION_RENDERER_URL: 'http://renderer.invalid:8790',
    }
    startTracked({
      name: names.bun,
      image: args.bunImage,
      network,
      aliases: ['api-bun'],
      env: apiEnvironment,
    })

    const databaseUrl = `postgres://obiter:${DB_PASSWORD}@127.0.0.1:${postgresPort}/${DB_NAME}`
    const ids = fixtureIds(newRunTag())
    const provisionFixtures = () => {
      const target = resolveDatabaseTarget({ databaseUrl })
      createQuerier({ databaseUrl: target.url }).exec(provisionSql(ids))
    }

    const proxyPorts = { apiPort: API_PORT, originPort: ORIGIN_PORT }
    const lifecycle = {
      switchBackend: (service) =>
        writeFile(dynamicPath, proxy.dynamicConfig(service, proxyPorts)),
      startNode: () => {
        startTracked({
          name: names.node,
          image: args.nodeImage,
          network,
          aliases: ['api-node'],
          env: apiEnvironment,
        })
      },
      signalBun: () => signalContainer(names.bun, 'SIGTERM'),
      bunRunning: () => containerRunning(names.bun),
      waitBunExit: () => waitForContainerExit(names.bun),
      bunExitCode: () => containerExitCode(names.bun),
      bunLogs: () => containerLogs(names.bun),
    }

    await runThroughProxyChecks({
      report,
      proxy,
      lifecycle,
      traefikPort,
      ids,
      docx,
      largeText,
      provisionFixtures,
    })

    const shortYaml = entrypointsYaml
      .replaceAll('readTimeout: 300s', 'readTimeout: 5s')
      .replaceAll('writeTimeout: 0s', 'writeTimeout: 5s')
    const shortDir = join(scratch, 'dynamic-short')
    await mkdir(shortDir, { recursive: true })
    await writeFile(
      join(scratch, 'traefik-short.yml'),
      proxy.staticConfig(shortYaml, { debug: false }),
    )
    await writeFile(
      join(shortDir, 'dyn.yml'),
      proxy.dynamicConfig('api-bun', proxyPorts),
    )
    const shortPort = await proxy.freePort()
    startTracked({
      name: names.traefikShort,
      image: TRAEFIK_IMAGE,
      network,
      ports: [`127.0.0.1:${shortPort}:80`],
      mounts: [
        `${join(scratch, 'traefik-short.yml')}:/etc/traefik/traefik.yml:ro`,
        `${shortDir}:${proxy.DYNAMIC_DIR}`,
      ],
      cmd: ['--configFile=/etc/traefik/traefik.yml'],
    })
    await waitFor(
      async () => {
        const probe = await proxy.readStream({
          port: shortPort,
          host: proxy.ORIGIN_HOST,
          path: '/health',
        })
        return probe.status === 200 ? true : null
      },
      { timeoutMs: 30_000, label: 'short-timeout Traefik ready' },
    )
    await runTimeoutControlChecks({ report, proxy, shortPort })

    jsonReport = {
      head: bunRevision,
      traefikImage: TRAEFIK_IMAGE,
      traefikDigest,
      entrypoints: ENTRYPOINTS_FILE.replace(`${ROOT}/`, ''),
      checks: report.checks,
      summary: report.summary(),
    }
  } finally {
    if (args.keep) {
      console.log(`\n--keep: leaving ${created.length} resources in place`)
    } else {
      teardownFailures = await teardownResources({
        resources: created,
        scratch,
        exists: (resource) =>
          resource.type === 'container'
            ? containerExists(resource.name)
            : networkExists(resource.name),
        removeContainer,
        networkRemove,
        removeScratch: (dir) => rm(dir, { recursive: true, force: true }),
      })
    }
    if (teardownFailures.length) {
      console.error(
        `\nTEARDOWN INCOMPLETE: ${teardownFailures.length} resource(s) could not be removed:`,
      )
      for (const failure of teardownFailures) console.error(`  - ${failure}`)
      process.exitCode = 1
    }
    if (args.jsonOut && jsonReport) {
      jsonReport.teardownFailures = teardownFailures
      try {
        await writeFile(args.jsonOut, JSON.stringify(jsonReport, null, 2))
      } catch (error) {
        console.error(`Could not write JSON report: ${error.message}`)
        process.exitCode = 1
      }
    }
  }

  const summary = report.summary()
  console.log(
    `\n${summary.passed}/${summary.total} checks passed` +
      (summary.failed.length ? `; failed: ${summary.failed.join(', ')}` : ''),
  )
  if (summary.failed.length) process.exitCode = 1
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`\nIngress harness error: ${error.message}`)
    if (!(error instanceof DockerError)) console.error(error.stack)
    process.exitCode = 2
  })
}
