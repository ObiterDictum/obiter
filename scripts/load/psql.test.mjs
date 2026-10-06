import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'bun:test'
import {
  ProvisionError,
  createQuerier,
  defaultRunner,
  psqlEnvironment,
} from './psql.mjs'

const connections =
  'postgresql://obiter:s3cret@localhost:5432/obiter_lane_security'

describe('psqlEnvironment', () => {
  it('passes credentials through the environment, never through arguments', () => {
    const environment = psqlEnvironment(connections, {
      PATH: '/usr/bin',
      HOME: '/home/x',
    })
    expect(environment.PGDATABASE).toBe('obiter_lane_security')
    expect(environment.PGHOST).toBe('localhost')
    expect(environment.PGPORT).toBe('5432')
    expect(environment.PGUSER).toBe('obiter')
    expect(environment.PGPASSWORD).toBe('s3cret')
    expect(Object.values(environment)).not.toContain(connections)
  })
})

describe('createQuerier', () => {
  it('runs SQL through the injected runner and parses the JSON aggregate', () => {
    const seen = []
    const querier = createQuerier({
      databaseUrl: connections,
      run: (sql, environment) => {
        seen.push({ sql, environment })
        return '[{"action":"document.upload","count":2}]'
      },
    })
    expect(querier.rows('select 1')).toEqual([
      { action: 'document.upload', count: 2 },
    ])
    expect(seen[0].sql).toBe('select 1')
    expect(seen[0].environment.PGPASSWORD).toBe('s3cret')
  })

  it('treats an empty result as no rows', () => {
    const querier = createQuerier({ databaseUrl: connections, run: () => '\n' })
    expect(querier.rows('select 1')).toEqual([])
  })
})

describe('psql command bounds', () => {
  const environment = psqlEnvironment(connections, {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  })

  it('passes a bounded duration and output cap to the command', () => {
    let seen = null
    defaultRunner('select 1', environment, {
      exec: (command, args, options) => {
        seen = { command, args, options }
        return ''
      },
    })

    expect(seen.command).toBe('psql')
    expect(seen.options.timeout).toBeGreaterThan(0)
    expect(seen.options.maxBuffer).toBeGreaterThan(0)
    expect(seen.options.killSignal).toBe('SIGKILL')
  })

  it('kills a hung command within the bound and calls it a timeout', () => {
    const started = Date.now()
    expect(() =>
      defaultRunner('select 1', environment, {
        exec: (command, args, options) =>
          execFileSync(
            process.execPath,
            ['-e', 'setTimeout(() => {}, 30000)'],
            options,
          ),
        timeoutMs: 250,
      }),
    ).toThrow(ProvisionError)
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('bounds a runaway result rather than returning a truncated one', () => {
    // A writer that respects backpressure blocks once the pipe fills, so the
    // output cap is what ends it rather than the child running out of memory.
    const writeForever =
      'const chunk="0123456789".repeat(6554);' +
      'const w=()=>{while(process.stdout.write(chunk)){}process.stdout.once("drain",w)};w()'
    let code = null
    try {
      defaultRunner('select 1', environment, {
        exec: (command, args, options) =>
          execFileSync(process.execPath, ['-e', writeForever], options),
      })
    } catch (error) {
      code = error.code
    }
    expect(code).toBe('query_output_limit')
  })
})
