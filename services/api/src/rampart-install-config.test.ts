import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'

/**
 * Guards the CPU-only ONNX Runtime install that this API's detection depends on.
 *
 * `onnxruntime-node`'s postinstall fetches the optional CUDA and TensorRT
 * execution providers (onnxruntime-linux-x64-gpu, ~343 MB unpacked) on Linux
 * x64 unless it is told to skip them. Detection loads with `device: 'cpu'`, so
 * no surface here consumes them.
 *
 * Under Bun there is no install setting to carry: Bun runs a dependency's
 * lifecycle scripts only for trusted dependencies, `onnxruntime-node` is not
 * in Bun's default-trusted set, and the workspace does not trust it. The
 * postinstall therefore never runs — for a developer install or an image
 * build alike — and there is nothing like the old repo-root `.npmrc` to copy
 * into a stage. Each assertion below pins one link of that chain; losing any
 * one is silent: the package becomes trusted, an image opts it in, or the
 * lockfile stops being the install's source of truth. Detection would then
 * degrade to heuristics with no obvious cause, or every cold install would
 * silently grow a ~343 MB payload nothing uses.
 *
 * The CPU libraries ship inside the package tarball and are placed whether or
 * not the postinstall runs, so nothing here asserts on payload files: a GPU
 * host that deliberately trusts the package stays a supported configuration.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const readRepoFile = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8')

/** Dockerfiles in the workspace, so a future API image is covered too. */
function workspaceDockerfiles(): string[] {
  return ['apps', 'packages', 'services', 'infra'].flatMap((group) =>
    readdirSync(join(repoRoot, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(group, entry.name, 'Dockerfile'))
      .filter((relativePath) => existsSync(join(repoRoot, relativePath))),
  )
}

interface Instruction {
  keyword: string
  value: string
}

/**
 * Dockerfile instructions with `\` line continuations joined and comment-only
 * lines dropped, so a multi-line RUN is analysed as one command and a mention
 * of `bun install` in a comment is not mistaken for an instruction.
 */
function dockerfileInstructions(source: string): Instruction[] {
  const instructions: Instruction[] = []
  let pending = ''
  for (const rawLine of source.split('\n')) {
    const joined = pending + rawLine
    if (joined.trimEnd().endsWith('\\')) {
      pending = `${joined.trimEnd().slice(0, -1)} `
      continue
    }
    pending = ''
    const line = joined.trim()
    if (line === '' || line.startsWith('#')) continue
    const [keyword = '', ...rest] = line.split(/\s+/)
    instructions.push({ keyword: keyword.toUpperCase(), value: rest.join(' ') })
  }
  return instructions
}

const unquote = (token: string) => token.replace(/^["']+|["',]+$/g, '')

/**
 * Command wrappers and env assignments that may precede the real command, so
 * `CI=1 bun install` counts as `bun install` in command position while a
 * quoted mention such as `echo "bun install"` does not — splitting that line
 * into tokens must not turn an argument into a command.
 */
const commandWrappers = new Set(['env', 'command', 'time', 'sudo', 'exec'])

/** Tokens of one shell segment, quotes stripped, empty tokens dropped. */
function shellTokens(segment: string): string[] {
  return segment
    .split(/\s+/)
    .map(unquote)
    .filter((token) => token.length > 0)
}

/**
 * Index of the real command after any wrappers and env assignments, or -1 for
 * an empty segment.
 */
function commandIndex(tokens: string[]): number {
  let i = 0
  while (
    i < tokens.length &&
    (commandWrappers.has(tokens[i] as string) ||
      (tokens[i] as string).includes('='))
  ) {
    i++
  }
  return i < tokens.length ? i : -1
}

/** Unwrap a JSON exec form to its shell string, or return the text as-is. */
function commandBody(run: string): string {
  const command = run.trim()
  if (!command.startsWith('[')) return command
  try {
    return (JSON.parse(command) as string[]).at(-1) ?? ''
  } catch {
    return command
  }
}

/**
 * True when a RUN body invokes `bun install` (or its alias `i`) in command
 * position. `bun --bun run …`, a quoted mention, and a comment do not count.
 */
function runsBunInstall(run: string): boolean {
  for (const segment of commandBody(run).split(/&&|\|\||[;&|()\n]/)) {
    const tokens = shellTokens(segment)
    const cursor = commandIndex(tokens)
    if (cursor === -1) continue
    if (tokens[cursor]?.replace(/^.*\//, '') !== 'bun') continue
    const sub = tokens[cursor + 1]
    if (sub === 'install' || sub === 'i') return true
    if (sub === 'pm' && tokens[cursor + 2] === 'install') return true
  }
  return false
}

/**
 * True when a RUN body opts onnxruntime-node into its lifecycle script: the
 * trust command in command position, or the GPU environment switch its
 * postinstall reads. Both are the GPU-host opt-in and neither may reach an
 * image.
 */
function optsIntoGpuProviders(run: string): boolean {
  const command = commandBody(run)
  if (/ONNXRUNTIME_NODE_INSTALL_CUDA/.test(command)) return true
  for (const segment of command.split(/&&|\|\||[;&|()\n]/)) {
    const tokens = shellTokens(segment)
    const cursor = commandIndex(tokens)
    if (cursor === -1) continue
    if (tokens[cursor]?.replace(/^.*\//, '') !== 'bun') continue
    if (tokens[cursor + 1] === 'pm' && tokens[cursor + 2] === 'trust') {
      if (tokens.slice(cursor + 3).some((t) => t.includes('onnxruntime')))
        return true
    }
  }
  return false
}

const copiesBunLock = (copyValue: string) =>
  copyValue.split(/\s+/).some((token) => token.split('/').pop() === 'bun.lock')

/**
 * Stages that run `bun install` before the root `bun.lock` is copied into
 * them. A `COPY` in a later stage does not satisfy an earlier one, and a stage
 * built `FROM` another stage inherits what that stage had copied: without the
 * lockfile a `--frozen-lockfile` install cannot run at all, so this keeps the
 * image's dependency graph pinned to the reviewed lockfile.
 */
function stagesMissingBunLock(dockerfile: string): string[] {
  const finalStageState = new Map<string, boolean>()
  const violations: string[] = []
  let stageName = ''
  let hasBunLock = false

  for (const { keyword, value } of dockerfileInstructions(dockerfile)) {
    if (keyword === 'FROM') {
      const [base = '', , alias = ''] = value.split(/\s+/)
      stageName = alias || `stage ${finalStageState.size + 1}`
      hasBunLock = finalStageState.get(base) ?? false
    } else if (stageName !== '') {
      if (keyword === 'COPY' && copiesBunLock(value)) {
        hasBunLock = true
      } else if (keyword === 'RUN' && runsBunInstall(value) && !hasBunLock) {
        violations.push(`${stageName} runs bun install without COPY bun.lock`)
      }
    }
    if (stageName !== '') finalStageState.set(stageName, hasBunLock)
  }

  return violations
}

/** Stages whose RUN bodies opt onnxruntime-node into the GPU provider fetch. */
function stagesOptingIntoGpu(dockerfile: string): string[] {
  const violations: string[] = []
  let stageName = ''
  for (const { keyword, value } of dockerfileInstructions(dockerfile)) {
    if (keyword === 'FROM') {
      const [base = '', , alias = ''] = value.split(/\s+/)
      stageName = alias || base
    } else if (
      stageName !== '' &&
      keyword === 'RUN' &&
      optsIntoGpuProviders(value)
    ) {
      violations.push(`${stageName} opts onnxruntime-node into GPU providers`)
    }
  }
  return violations
}

describe('CPU-only ONNX Runtime install', () => {
  it('runs no install-time setting: the old npmrc is gone, not carried along', () => {
    expect(existsSync(join(repoRoot, '.npmrc'))).toBe(false)
  })

  it('keeps onnxruntime-node outside every trust allowlist', () => {
    const root = JSON.parse(readRepoFile('package.json')) as {
      trustedDependencies?: Record<string, unknown>
    }
    expect(root.trustedDependencies?.['onnxruntime-node']).toBeUndefined()
  })

  it('relies on Bun default-deny: the package is not default-trusted', () => {
    // The structural heart of the policy: if a future Bun release starts
    // trusting onnxruntime-node by default, this fails before any install
    // silently grows the ~343 MB provider payload.
    const output = execFileSync('bun', ['pm', 'default-trusted'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(output).not.toContain('onnxruntime-node')
  })

  it('tracks the dependency in bun.lock, the install source of truth', () => {
    const lock = readRepoFile('bun.lock')
    expect(lock).toContain('onnxruntime-node')
    expect(existsSync(join(repoRoot, 'pnpm-lock.yaml'))).toBe(false)
    expect(existsSync(join(repoRoot, 'pnpm-workspace.yaml'))).toBe(false)
  })

  it('keeps every image stage pinned to the lockfile and CPU-only', () => {
    const dockerfiles = workspaceDockerfiles()
    expect(dockerfiles.length).toBeGreaterThan(0)
    expect(
      dockerfiles.some((relativePath) =>
        readRepoFile(relativePath).includes('bun install'),
      ),
    ).toBe(true)

    for (const relativePath of dockerfiles) {
      const source = readRepoFile(relativePath)
      expect(stagesMissingBunLock(source), relativePath).toEqual([])
      expect(stagesOptingIntoGpu(source), relativePath).toEqual([])
    }
  })

  describe('dependency materialisation without the root bun.lock', () => {
    const dockerfile = (body: string) => `FROM node:22-slim\n${body}\n`

    it('flags install with and without flags, and the pm form', () => {
      for (const command of [
        'bun install --frozen-lockfile',
        'bun install --frozen-lockfile --production --filter @obiter/api',
        'bun i',
        'bun pm install',
        'CI=1 bun install',
      ]) {
        expect(
          stagesMissingBunLock(dockerfile(`RUN ${command}`)),
          command,
        ).toHaveLength(1)
      }
    })

    it('flags a multi-line install', () => {
      const multiline =
        'FROM node:22-slim\nRUN --mount=type=cache,id=store,target=/store \\\n    bun install --frozen-lockfile\n'
      expect(stagesMissingBunLock(multiline)).toHaveLength(1)
    })

    it('flags a JSON exec-form install', () => {
      expect(
        stagesMissingBunLock(dockerfile('RUN ["sh", "-c", "bun install"]')),
      ).toHaveLength(1)
    })

    it('accepts a copy of the root bun.lock before the install', () => {
      expect(
        stagesMissingBunLock(
          dockerfile('COPY package.json bun.lock ./\nRUN bun install'),
        ),
      ).toEqual([])
    })

    it('does not let a later stage copy satisfy an earlier install', () => {
      const twoStages =
        'FROM node:22-slim AS build\nRUN bun install --frozen-lockfile\nFROM node:22-slim AS runtime\nCOPY bun.lock ./\n'
      expect(stagesMissingBunLock(twoStages)).toEqual([
        'build runs bun install without COPY bun.lock',
      ])
    })

    it('inherits the copy from the stage a stage is built from', () => {
      const chained =
        'FROM node:22-slim AS build\nCOPY bun.lock ./\nRUN bun install\nFROM build AS runtime\nRUN bun --bun run build\n'
      expect(stagesMissingBunLock(chained)).toEqual([])
    })

    it('does not flag an image that only compiles', () => {
      expect(
        stagesMissingBunLock(
          dockerfile('RUN bun --bun run --filter @obiter/web build'),
        ),
      ).toEqual([])
    })

    it('does not flag a mention inside a comment or an echo', () => {
      expect(
        stagesMissingBunLock(
          dockerfile(
            '# bun install must copy bun.lock\nRUN echo "bun install"',
          ),
        ),
      ).toEqual([])
    })
  })

  describe('GPU provider opt-in never reaches an image', () => {
    const dockerfile = (body: string) => `FROM node:22-slim\n${body}\n`

    it('flags bun pm trust of onnxruntime-node', () => {
      expect(
        stagesOptingIntoGpu(dockerfile('RUN bun pm trust onnxruntime-node')),
      ).toHaveLength(1)
      expect(
        stagesOptingIntoGpu(
          dockerfile(
            'RUN bun pm trust @huggingface/transformers onnxruntime-node',
          ),
        ),
      ).toHaveLength(1)
    })

    it('flags the GPU environment switch in a RUN', () => {
      expect(
        stagesOptingIntoGpu(
          dockerfile(
            'RUN ONNXRUNTIME_NODE_INSTALL_CUDA=v12 bun pm trust onnxruntime-node',
          ),
        ),
      ).toHaveLength(1)
    })

    it('accepts a plain install and comment mentions', () => {
      expect(stagesOptingIntoGpu(dockerfile('RUN bun install'))).toEqual([])
      expect(
        stagesOptingIntoGpu(
          dockerfile(
            '# bun pm trust onnxruntime-node is for GPU hosts only\nRUN bun install',
          ),
        ),
      ).toEqual([])
    })
  })
})
