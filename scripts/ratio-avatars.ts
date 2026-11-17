import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { agentPresenceSchema } from '../packages/contracts/src/agent-presence'
import { RatioMascot } from '../packages/ui/src/ratio-mascot'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'apps/web/public/ratio')
const css = await readFile(
  join(root, 'packages/ui/src/ratio-mascot.css'),
  'utf8',
)
const size = 512
const art = 400

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: size, height: size },
  deviceScaleFactor: 1,
})
await page.emulateMedia({ reducedMotion: 'reduce' })

for (const state of agentPresenceSchema.options) {
  await page.setContent(
    `<!doctype html><style>${css}html,body{margin:0;background:transparent}</style><div id="avatar" style="width:${size}px;height:${size}px;display:grid;place-items:center">${renderToStaticMarkup(
      createElement(RatioMascot, { state, size: art, live: false }),
    )}</div>`,
  )
  const path = join(outDir, `${state}.png`)
  await page.locator('#avatar').screenshot({ path, omitBackground: true })
  const { size: bytes } = await stat(path)
  if (bytes > 60_000)
    throw new Error(`${state}.png is ${bytes} bytes, over the 60 kB avatar cap`)
  console.log(`${state}.png ${Math.round(bytes / 1024)} kB`)
}

await browser.close()
