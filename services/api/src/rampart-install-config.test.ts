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
 * the setting disappears, an image build never sees it, or the download is
 * "fixed" by dropping the package from the lifecycle allowlist and the CPU
 * libraries stop being placed. Detection then degrades to heuristics with no
 * obvious cause.
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

    // Removing onnxruntime-node from the allowlist would also stop its CPU
    // libraries being placed, which is the failure this skip exists to avoid.
    expect(allowlist).toContain('onnxruntime-node')
  })

  it('carries the install setting into every image build that installs with pnpm', () => {
    const dockerfiles = workspaceDockerfiles()
    expect(dockerfiles.length).toBeGreaterThan(0)

    const installing = dockerfiles.filter((relativePath) =>
      readRepoFile(relativePath).includes('pnpm install'),
    )
    expect(installing.length).toBeGreaterThan(0)

    for (const relativePath of installing) {
      const lines = readRepoFile(relativePath).split('\n')
      const installAt = lines.findIndex((line) => line.includes('pnpm install'))
      // A COPY after the install cannot affect it, and a mention of .npmrc in a
      // comment is not a copy, so only COPY instructions above the install count.
      const copiedBeforeInstall = lines
        .slice(0, installAt)
        .some((line) => line.startsWith('COPY') && line.includes('.npmrc'))

      expect(copiedBeforeInstall, relativePath).toBe(true)
    }
  })
})
