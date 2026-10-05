import { loadRendererAssets } from './assets'
import { createDocxRenderer, type DocxRenderer } from './renderer'
import { createRendererServer, type RendererLogEvent } from './server'

// Private by default: a deployment that needs to reach the worker from another
// container sets the host explicitly, and nothing else can guess the port.
const host = process.env.REDACTION_RENDERER_HOST ?? '127.0.0.1'
const port = Number(process.env.REDACTION_RENDERER_PORT ?? '8790')

let renderer: DocxRenderer | null = null

const server = createRendererServer({
  getRenderer: () => renderer,
  log: (event: RendererLogEvent) => {
    const code = event.code ? ` ${event.code}` : ''
    console.log(`renderer ${event.method} ${event.path} ${event.status}${code}`)
  },
})

server.listen(port, host, () => {
  console.log(`renderer listening on ${host}:${port}`)
})

void start()

async function start(): Promise<void> {
  try {
    const assets = await loadRendererAssets()
    renderer = await createDocxRenderer({ assets })
    console.log('renderer ready')
  } catch {
    // No document content, filename or stack: the code alone names the state.
    console.error('renderer failed to become ready; /ready stays 503')
  }
}

function shutdown(): void {
  server.close()
  void renderer?.close().finally(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
