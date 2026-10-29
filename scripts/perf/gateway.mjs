import { createServer, request as httpRequest } from 'node:http'

function forward(req, res, origin) {
  const target = new URL(req.url ?? '/', origin)
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: target.pathname + target.search,
      headers: { ...req.headers, host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('gateway: upstream error\n')
  })
  req.pipe(upstream)
}

export function startGateway({
  port,
  ssrOrigin,
  apiOrigin,
  host = '127.0.0.1',
}) {
  const server = createServer((req, res) => {
    const path = req.url ?? '/'
    forward(req, res, path.startsWith('/api/') ? apiOrigin : ssrOrigin)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve(server))
  })
}
