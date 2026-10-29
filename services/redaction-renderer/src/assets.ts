import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RendererAssets {
  script: string
  css: string
}

export const RENDERER_ASSETS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'dist',
)

export async function loadRendererAssets(
  directory: string = RENDERER_ASSETS_DIR,
): Promise<RendererAssets> {
  const [script, css] = await Promise.all([
    readFile(join(directory, 'render-bundle.js'), 'utf8'),
    readFile(join(directory, 'render.css'), 'utf8'),
  ])
  return { script, css }
}
