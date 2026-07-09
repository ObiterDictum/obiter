import { serve } from '@hono/node-server'
import { createApiApp } from './app'
import { createPool } from './database'
import { readApiEnv } from './env'

const env = readApiEnv()
const pool = createPool(env)
const app = createApiApp(env, pool)

serve({
  fetch: app.fetch,
  port: env.port,
})

console.info(`Obiter API listening on http://localhost:${env.port}`)
