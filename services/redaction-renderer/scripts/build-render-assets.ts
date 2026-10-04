import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'

/**
 * Builds the two browser assets the worker injects into Chromium. Both derive
 * from app-shell source: the bundle reuses its pagination and page components,
 * and the stylesheet is the Tailwind the page components are written against.
 * Tailwind is a build-time dependency only; the running worker reads `dist/`.
 */
const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repoRoot = resolve(packageRoot, '..', '..')
const uiSrc = resolve(repoRoot, 'packages/ui/src')
const appShellSrc = resolve(repoRoot, 'packages/app-shell/src')
const outDir = resolve(packageRoot, 'dist')

const tailwindEntry = resolve(uiSrc, 'tailwind.css')
const css = await readFile(tailwindEntry, 'utf8')
const compiler = await compile(css, {
  base: uiSrc,
  from: tailwindEntry,
  onDependency() {},
})
const scanner = new Scanner({
  sources: [
    { base: appShellSrc, pattern: '**/*', negated: false },
    { base: uiSrc, pattern: '**/*', negated: false },
  ],
})
const compiledCss = compiler.build(scanner.scan())

const result = await Bun.build({
  entrypoints: [resolve(packageRoot, 'src/browser-entry.tsx')],
  outdir: outDir,
  target: 'browser',
  format: 'iife',
  naming: 'render-bundle.js',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
})
if (!result.success) {
  for (const log of result.logs) console.error(log.level, String(log))
  process.exit(1)
}

await mkdir(outDir, { recursive: true })
await writeFile(resolve(outDir, 'render.css'), compiledCss)
console.log('wrote render-bundle.js and render.css')
