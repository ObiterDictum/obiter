import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the CPU-only ONNX Runtime install that this API's detection depends on.
 *
 * `onnxruntime-node`'s postinstall fetches the optional CUDA and TensorRT
 * execution providers (onnxruntime-linux-x64-gpu, ~343 MB unpacked) on Linux x64
 * unless it is told to skip them. Detection loads with `device: 'cpu'`, so no
 * surface here consumes them, and the repo skips the download while keeping the
 * GPU path as an explicit opt-in.
 *
 * Each file below carries part of that decision and losing any one is silent:
 * the setting disappears or an image build never sees it. Detection then
 * degrades to heuristics with no obvious cause.
 *
 * `pnpm-workspace.yaml` also keeps `onnxruntime-node` in
 * `onlyBuiltDependencies`, which is what lets a GPU host take the opt-in at all:
 * pnpm runs no lifecycle script for a package outside the allowlist, so there
 * would be nothing for `pnpm rebuild onnxruntime-node` to re-run. The allowlist
 * says nothing about the CPU libraries, which ship inside the package tarball
 * and are placed whether or not the postinstall runs.
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
 * lines dropped, so a multi-line RUN is analysed as one command and a mention of
 * `pnpm install` in a comment is not mistaken for an instruction.
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

/**
 * pnpm subcommands that materialise workspace dependencies, plus `rebuild`,
 * which re-runs the lifecycle this install setting governs. Value-taking flags
 * are skipped so `pnpm --filter @obiter/api deploy` and
 * `pnpm deploy --filter @obiter/api` both resolve to `deploy`.
 */
const dependencyCommands = new Set([
  'install',
  'i',
  'deploy',
  'fetch',
  'add',
  'rebuild',
])

const valueTakingFlags = new Set([
  '--filter',
  '-F',
  '--dir',
  '-C',
  '--config',
  '--config-dir',
  '--store-dir',
  '--registry',
  '--reporter',
  '--package-import-method',
  '--virtual-store-dir',
  '--global-dir',
  '--global-bin-dir',
])

const commandWrappers = new Set([
  'env',
  'exec',
  'command',
  'corepack',
  'npx',
  'pnpx',
  'time',
  'sudo',
])

const unquote = (token: string) => token.replace(/^["']+|["',]+$/g, '')

/**
 * Dependency-materialising pnpm commands in one RUN body. `pnpm` must be in
 * command position, so `echo "pnpm install"` and a script named `deploy` do not
 * count, and the JSON exec form is unwrapped before scanning.
 */
function pnpmDependencyCommands(run: string): string[] {
  let command = run.trim()
  if (command.startsWith('[')) {
    try {
      const parts = JSON.parse(command) as string[]
      command = parts.at(-1) ?? ''
    } catch {
      // Not a JSON exec form; scan the text as shell below.
    }
  }

  const found: string[] = []
  for (const segment of command.split(/&&|\|\||[;&|()\n]/)) {
    const tokens = segment
      .split(/\s+/)
      .map(unquote)
      .filter((token) => token.length > 0 && !token.includes('='))
    let cursor = 0
    while (commandWrappers.has(tokens[cursor] ?? '')) cursor++
    if (tokens[cursor]?.replace(/^.*\//, '') !== 'pnpm') continue
    for (cursor++; cursor < tokens.length; cursor++) {
      const token = tokens[cursor] as string
      if (valueTakingFlags.has(token)) {
        cursor++
        continue
      }
      if (token.startsWith('-')) continue
      if (dependencyCommands.has(token)) found.push(token)
      break
    }
  }
  return found
}

const copiesNpmrc = (copyValue: string) =>
  copyValue.split(/\s+/).some((token) => token.split('/').pop() === '.npmrc')

/**
 * Stages that run a pnpm dependency command before the root `.npmrc` is copied
 * into them. A `COPY` in a later stage does not satisfy an earlier one, and a
 * stage built `FROM` another stage inherits what that stage had copied.
 */
function stagesMissingNpmrc(dockerfile: string): string[] {
  const finalStageState = new Map<string, boolean>()
  const violations: string[] = []
  let stageName = ''
  let hasNpmrc = false

  for (const { keyword, value } of dockerfileInstructions(dockerfile)) {
    if (keyword === 'FROM') {
      const [base = '', , alias = ''] = value.split(/\s+/)
      stageName = alias || `stage ${finalStageState.size + 1}`
      hasNpmrc = finalStageState.get(base) ?? false
    } else if (stageName !== '') {
      if (keyword === 'COPY' && copiesNpmrc(value)) {
        hasNpmrc = true
      } else if (keyword === 'RUN') {
        for (const command of pnpmDependencyCommands(value)) {
          if (!hasNpmrc) {
            violations.push(
              `${stageName} runs pnpm ${command} without COPY .npmrc`,
            )
          }
        }
      }
    }
    if (stageName !== '') finalStageState.set(stageName, hasNpmrc)
  }

  return violations
}

describe('CPU-only ONNX Runtime install', () => {
  it('skips the optional CUDA and TensorRT provider download', () => {
    expect(readRepoFile('.npmrc')).toContain(
      'onnxruntime-node-install-cuda=skip',
    )
  })

  it('keeps the download decision in the install setting, not in the allowlist', () => {
    const workspace = readRepoFile('pnpm-workspace.yaml')
    const allowlist = workspace.slice(
      workspace.indexOf('onlyBuiltDependencies'),
    )

    // Without the allowlist entry pnpm runs no lifecycle script, so a GPU host
    // could not rebuild into the provider form. It is the opt-in that depends on
    // this line, not the CPU libraries.
    expect(allowlist).toContain('onnxruntime-node')
  })

  it('carries the install setting into every image stage that materialises dependencies', () => {
    const dockerfiles = workspaceDockerfiles()
    expect(dockerfiles.length).toBeGreaterThan(0)
    expect(
      dockerfiles.some((relativePath) =>
        readRepoFile(relativePath).includes('pnpm install'),
      ),
    ).toBe(true)

    for (const relativePath of dockerfiles) {
      expect(
        stagesMissingNpmrc(readRepoFile(relativePath)),
        relativePath,
      ).toEqual([])
    }
  })

  describe('dependency materialisation without the root .npmrc', () => {
    const dockerfile = (body: string) => `FROM node:22-slim\n${body}\n`

    it('flags install, deploy in either order, fetch, add and rebuild', () => {
      for (const command of [
        'pnpm install --frozen-lockfile',
        'pnpm --filter @obiter/api deploy --prod /out',
        'pnpm deploy --filter @obiter/api /out',
        'pnpm fetch',
        'pnpm add onnxruntime-node',
        'pnpm rebuild onnxruntime-node',
      ]) {
        expect(
          stagesMissingNpmrc(dockerfile(`RUN ${command}`)),
          command,
        ).toHaveLength(1)
      }
    })

    it('flags a multi-line install', () => {
      const multiline =
        'FROM node:22-slim\nRUN --mount=type=cache,id=store,target=/store \\\n    pnpm install --frozen-lockfile\n'
      expect(stagesMissingNpmrc(multiline)).toHaveLength(1)
    })

    it('flags a JSON exec-form install', () => {
      expect(
        stagesMissingNpmrc(dockerfile('RUN ["sh", "-c", "pnpm install"]')),
      ).toHaveLength(1)
    })

    it('accepts a copy of the root .npmrc before the install', () => {
      expect(
        stagesMissingNpmrc(
          dockerfile(
            'COPY package.json pnpm-lock.yaml .npmrc ./\nRUN pnpm install',
          ),
        ),
      ).toEqual([])
    })

    it('does not let a later stage copy satisfy an earlier install', () => {
      const twoStages =
        'FROM node:22-slim AS build\nRUN pnpm install --frozen-lockfile\nFROM node:22-slim AS runtime\nCOPY .npmrc ./\n'
      expect(stagesMissingNpmrc(twoStages)).toEqual([
        'build runs pnpm install without COPY .npmrc',
      ])
    })

    it('inherits the copy from the stage a stage is built from', () => {
      const chained =
        'FROM node:22-slim AS build\nCOPY .npmrc ./\nRUN pnpm install\nFROM build AS runtime\nRUN pnpm deploy --filter @obiter/api\n'
      expect(stagesMissingNpmrc(chained)).toEqual([])
    })

    it('does not flag an image that only compiles', () => {
      expect(
        stagesMissingNpmrc(dockerfile('RUN pnpm --filter @obiter/web build')),
      ).toEqual([])
    })

    it('does not flag a mention inside a comment or an echo', () => {
      expect(
        stagesMissingNpmrc(
          dockerfile('# pnpm install must copy .npmrc\nRUN echo "pnpm deploy"'),
        ),
      ).toEqual([])
    })
  })
})
