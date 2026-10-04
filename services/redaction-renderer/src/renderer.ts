import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import {
  parseDocx,
  readPackageImageParts,
  serialiseModelJson,
} from '@obiter/ooxml'
import type { RedactionRendererErrorCode } from './contract'
import type { DocumentRenderResult } from './browser-entry'
import { RENDERER_LIMITS, type RendererLimits } from './limits'
import type { RendererAssets } from './assets'

/** A fail-closed renderer error. The server maps the code to a safe message. */
export class RendererFailure extends Error {
  constructor(readonly code: RedactionRendererErrorCode) {
    super(code)
    this.name = 'RendererFailure'
  }
}

export interface DocxRenderer {
  readonly ready: boolean
  render(docx: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>
  close(): Promise<void>
}

export interface DocxRendererConfig {
  assets: RendererAssets
  limits?: RendererLimits
  /** Base directory for the isolated work and Chromium profile. */
  baseTempDir?: string
}

const RENDER_SHELL_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Obiter document renderer</title></head><body></body></html>'

/**
 * Chromium renders this itself, and its sandbox, DNS blackhole and heap ceiling
 * are the isolation boundary: the page loads no network resource and its only
 * script is the injected app-shell bundle.
 */
const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--disable-component-update',
  '--host-resolver-rules=MAP * ~NOTFOUND',
]

/** Image types a Chromium `<img>` can paint; others fall back to a placeholder. */
const RENDERABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/svg+xml',
])

/** The browser bundle's entry point, exposed on the injected global. */
async function runBrowserRender(input: {
  modelJson: string
  imageUrls: Record<string, string>
}): Promise<DocumentRenderResult> {
  const render = window.__obiterRenderDocument
  if (!render) throw new Error('The renderer page is not warmed.')
  return await render(JSON.parse(input.modelJson), input.imageUrls)
}

export async function createDocxRenderer(
  config: DocxRendererConfig,
): Promise<DocxRenderer> {
  const limits = config.limits ?? RENDERER_LIMITS
  const baseDir = config.baseTempDir
    ? await prepareFixedDir(config.baseTempDir)
    : await mkdtemp(join(tmpdir(), 'obiter-render-'))
  const context = await chromium.launchPersistentContext(
    join(baseDir, 'chromium-profile'),
    {
      headless: true,
      args: [
        ...CHROMIUM_ARGS,
        `--js-flags=--max-old-space-size=${limits.browserHeapMb}`,
      ],
    },
  )
  const queue = createRenderQueue(limits.maxQueuedRenders)
  let page = await createWarmPage(context, config.assets)
  let ready = true
  let pageStuck = false

  async function resetPage(): Promise<void> {
    if (pageStuck || page.isClosed()) {
      await page.close().catch(() => undefined)
      page = await createWarmPage(context, config.assets)
      return
    }
    await page
      .evaluate(() => {
        document.body.replaceChildren()
      })
      .catch(() => undefined)
  }

  return {
    get ready() {
      return ready
    },

    async render(docx, signal) {
      if (!ready) throw new RendererFailure('not_ready')
      if (signal?.aborted) throw new RendererFailure('render_cancelled')
      if (docx.byteLength > limits.maxInputBytes) {
        throw new RendererFailure('input_too_large')
      }
      await queue.acquire()
      const renderDir = await mkdtemp(join(baseDir, 'render-'))
      const inputPath = join(renderDir, 'input.docx')
      try {
        if (signal?.aborted) throw new RendererFailure('render_cancelled')
        // The isolated directory holds the bounded input for the length of the
        // render; parsing reads it back so no caller buffer outlives the slot.
        await writeFile(inputPath, docx, { mode: 0o600 })
        const stored = await readFile(inputPath)
        const modelJson = serialiseModelJson(await parseDocxInput(stored))
        const imageUrls = await imageUrlsFor(stored)
        const result = await raceRender(
          page.evaluate(runBrowserRender, { modelJson, imageUrls }),
          limits.renderTimeoutMs,
          signal,
          () => {
            pageStuck = true
          },
        )
        assertRenderable(result, limits)
        const pdf = await raceRender(
          page.pdf({ printBackground: true, preferCSSPageSize: true }),
          limits.renderTimeoutMs,
          signal,
          () => {
            pageStuck = true
          },
        )
        if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
          throw new RendererFailure('render_failed')
        }
        return new Uint8Array(pdf)
      } finally {
        await resetPage()
        pageStuck = false
        await rm(renderDir, { recursive: true, force: true })
        queue.release()
      }
    },

    async close() {
      ready = false
      await context.close().catch(() => undefined)
      await rm(baseDir, { recursive: true, force: true })
    },
  }
}

async function prepareFixedDir(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return directory
}

async function createWarmPage(
  context: BrowserContext,
  assets: RendererAssets,
): Promise<Page> {
  const page = await context.newPage()
  await page.setContent(RENDER_SHELL_HTML, { waitUntil: 'load' })
  await page.addStyleTag({ content: assets.css })
  await page.addScriptTag({ content: assets.script })
  // Measure and paint only once the fallback faces have settled.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return page
}

async function parseDocxInput(bytes: Uint8Array) {
  try {
    return await parseDocx(bytes)
  } catch {
    throw new RendererFailure('invalid_docx')
  }
}

async function imageUrlsFor(
  bytes: Uint8Array,
): Promise<Record<string, string>> {
  const parts = await readPackageImageParts(bytes)
  const urls: Record<string, string> = {}
  for (const [name, part] of parts) {
    if (!RENDERABLE_IMAGE_TYPES.has(part.contentType)) continue
    urls[name] =
      `data:${part.contentType};base64,${Buffer.from(part.bytes).toString('base64')}`
  }
  return urls
}

function assertRenderable(
  result: DocumentRenderResult,
  limits: RendererLimits,
) {
  if (
    result.pageCount < 1 ||
    !Number.isFinite(result.widthPx) ||
    result.widthPx <= 0 ||
    !Number.isFinite(result.heightPx) ||
    result.heightPx <= 0
  ) {
    throw new RendererFailure('unsupported_document')
  }
  if (result.pageCount > limits.maxPages) {
    throw new RendererFailure('too_many_pages')
  }
}

/**
 * Fails a render on timeout or caller abort. A fired bound marks the page stuck
 * so the finally block discards it rather than reusing a page mid-render.
 */
function raceRender<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onBound: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => {
      onBound()
      settle(() => reject(new RendererFailure('render_cancelled')))
    }
    const settle = (finish: () => void) => {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
      signal?.removeEventListener('abort', onAbort)
      finish()
    }
    timer = setTimeout(() => {
      onBound()
      settle(() => reject(new RendererFailure('render_timeout')))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    )
  })
}

/** One Chromium page, so one render at a time; a bounded queue waits for it. */
function createRenderQueue(maxWaiting: number) {
  let active = false
  const waiters: Array<() => void> = []
  return {
    acquire(): Promise<void> {
      if (!active) {
        active = true
        return Promise.resolve()
      }
      if (waiters.length >= maxWaiting) {
        return Promise.reject(new RendererFailure('at_capacity'))
      }
      return new Promise<void>((resolve) => waiters.push(resolve))
    },
    release() {
      const next = waiters.shift()
      if (next) next()
      else active = false
    },
  }
}
