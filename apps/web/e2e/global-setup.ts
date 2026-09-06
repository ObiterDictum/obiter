import net from 'node:net'

const MEILI_HOST = process.env.MEILISEARCH_HOST ?? 'http://127.0.0.1:7700'

async function checkMeilisearch() {
  try {
    const res = await fetch(`${MEILI_HOST}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch {
    throw new Error(
      `Meilisearch not reachable at ${MEILI_HOST}\n` +
        `Start it with: docker compose -f infra/docker/compose.yaml up -d`,
    )
  }
}

async function checkPostgres() {
  const host = '127.0.0.1'
  const port = 5432
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 2000 }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
  if (!reachable) {
    throw new Error(
      `Postgres not reachable at ${host}:${port}\n` +
        `Start it with: docker start obiter-postgres\n` +
        `Or: docker run -d --name obiter-postgres -p 5432:5432 -e POSTGRES_USER=obiter -e POSTGRES_PASSWORD=obiter -e POSTGRES_DB=obiter postgres:16-alpine`,
    )
  }
}

export default async function globalSetup() {
  await checkPostgres()
  await checkMeilisearch()
}
