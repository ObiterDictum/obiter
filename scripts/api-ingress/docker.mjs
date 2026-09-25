/*
 * Docker CLI boundary for the ingress harness.
 *
 * Every container this starts is task-named and removed at teardown. Nothing
 * here touches the shared dev stack: no existing container is inspected,
 * stopped or renamed, and no host port outside the task's own ephemeral
 * loopback allocations is bound. Traefik runs without the Docker socket,
 * because the routes under test come from the file provider — the disposable
 * proxy has no authority over any other container.
 */
import { spawn, spawnSync } from 'node:child_process'

export class DockerError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DockerError'
    this.code = code
  }
}

/** One docker invocation. Args are passed directly, never through a shell. */
export function docker(args, { input, timeoutMs = 180_000 } = {}) {
  const result = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    killSignal: 'SIGKILL',
  })
  if (result.error) {
    throw new DockerError(
      'docker_spawn',
      `docker ${args[0]} could not run: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new DockerError(
      'docker_failed',
      `docker ${args.join(' ')} exited ${result.status}: ${(result.stderr ?? '').trim()}`,
    )
  }
  return result.stdout ?? ''
}

/** A docker invocation whose failure is an expected answer, not an error. */
export function dockerQuiet(args, options) {
  try {
    return docker(args, options)
  } catch {
    return null
  }
}

export function networkCreate(name) {
  docker(['network', 'create', name])
}

export function networkRemove(name) {
  dockerQuiet(['network', 'rm', name], { timeoutMs: 60_000 })
}

export function startContainer({
  name,
  image,
  network,
  aliases = [],
  env = {},
  ports = [],
  mounts = [],
  cmd = [],
  workdir,
}) {
  const args = ['run', '-d', '--name', name]
  if (network) args.push('--network', network)
  for (const alias of aliases) args.push('--network-alias', alias)
  if (workdir) args.push('--workdir', workdir)
  for (const [key, value] of Object.entries(env)) {
    args.push('-e', `${key}=${value}`)
  }
  for (const mapping of ports) args.push('-p', mapping)
  for (const mount of mounts) args.push('-v', mount)
  args.push(image, ...cmd)
  return docker(args, { timeoutMs: 180_000 }).trim()
}

export function containerExec(name, args) {
  return docker(['exec', name, ...args], { timeoutMs: 60_000 })
}

export function containerLogs(name) {
  return dockerQuiet(['logs', name], { timeoutMs: 30_000 }) ?? ''
}

export function containerExitCode(name) {
  return Number(
    docker(['inspect', '--format', '{{.State.ExitCode}}', name]).trim(),
  )
}

export function containerRunning(name) {
  return (
    (dockerQuiet(['inspect', '--format', '{{.State.Running}}', name])?.trim() ??
      'false') === 'true'
  )
}

/** SIGTERM, then SIGKILL after `timeoutSec`; returns when the process is out. */
export function stopContainer(name, timeoutSec = 30) {
  docker(['stop', '-t', String(timeoutSec), name], {
    timeoutMs: (timeoutSec + 30) * 1000,
  })
}

/**
 * Send one signal without blocking. `stopContainer` is synchronous, so it
 * cannot be used while the caller must keep reading a response the container is
 * draining: the drain would never finish and the caller would deadlock against
 * its own stop.
 */
export function signalContainer(name, signal = 'SIGTERM') {
  return new Promise((resolveSignal) => {
    const child = spawn('docker', ['kill', '--signal', signal, name], {
      stdio: 'ignore',
    })
    child.on('exit', (code) => resolveSignal(code))
    child.on('error', () => resolveSignal(null))
  })
}

/** Wait for a container to leave the running state after a signal. */
export async function waitForContainerExit(name, timeoutMs = 40_000) {
  await waitFor(() => (containerRunning(name) ? null : true), {
    timeoutMs,
    label: `${name} exited`,
  })
}

export function removeContainer(name) {
  dockerQuiet(['rm', '-f', '-v', name], { timeoutMs: 60_000 })
}

/** The `org.opencontainers.image.revision` label, or null when unlabelled. */
export function imageRevision(image) {
  const value = dockerQuiet([
    'image',
    'inspect',
    '--format',
    '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
    image,
  ])
  const trimmed = value?.trim() ?? ''
  return trimmed === '' || trimmed === '<no value>' ? null : trimmed
}

/** The first RepoDigest, which pins a pulled image by content. */
export function imageDigest(image) {
  const value = dockerQuiet([
    'image',
    'inspect',
    '--format',
    '{{ index .RepoDigests 0 }}',
    image,
  ])
  const trimmed = value?.trim() ?? ''
  return trimmed === '' || trimmed === '<no value>' ? null : trimmed
}

export function imageExists(image) {
  return dockerQuiet(['image', 'inspect', image]) !== null
}

/** Poll `predicate` until it returns a truthy value or the deadline passes. */
export async function waitFor(
  predicate,
  { timeoutMs, intervalMs = 500, label = 'condition' },
) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await predicate()
    if (last) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new DockerError(
    'wait_timeout',
    `${label} did not become true within ${timeoutMs}ms (last: ${JSON.stringify(last)})`,
  )
}
