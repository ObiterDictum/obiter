/*
 * Lifecycle regressions for the bounded editor-interaction samples.
 *
 * The defect these pin: `bounded()` used to win its race by rejecting and walk
 * away, leaving the abandoned probe's page and browser context repaginating
 * while later samples were measured in the same browser. The retained
 * `after-typing-large` run is the evidence — samples 0 and 1 exceeded the 300 s
 * bound, and samples 2 to 4 then could not finish `page.goto` within 30 s.
 *
 * The "close was called" assertion this does not make: the owned resource is a
 * real child process, and the evidence is that the process is actually gone
 * before the next sample starts. A second process that the ledger does not own
 * stays alive throughout, which is the check that an abandoned sample never
 * closes something it did not create.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { test } from 'vitest'
import { ownResource, stopOwned } from './owned-server.mjs'
import { runSamples } from './probe-lifecycle.mjs'

function spawnWorker() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  })
}

function running(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve()
  return new Promise((resolve) => child.once('exit', resolve))
}

async function stopWorker(child) {
  child.kill('SIGKILL')
  await waitForExit(child)
}

test('a timed-out probe stops its owned worker before the next sample starts', async () => {
  const events = []
  const ownedPids = []
  let unowned = null
  let call = 0
  const result = await runSamples({
    mode: 'typing',
    samples: 2,
    timeoutMs: 50,
    probe: async (ownership) => {
      call += 1
      if (call === 1) {
        const owned = spawnWorker()
        unowned = spawnWorker()
        ownedPids.push(owned.pid)
        await ownership.create(async () => ({
          close: async () => {
            events.push('closing owned')
            await stopWorker(owned)
            events.push('closed owned')
          },
        }))
        return new Promise(() => {})
      }
      events.push(`sample2 ownedAlive=${running(ownedPids[0])}`)
      return { ok: true }
    },
  })

  assert.deepEqual(
    result.failed.map((sample) => sample.index),
    [0],
  )
  assert.match(result.failed[0].reason, /exceeded 0\.05s/)
  assert.equal(result.aborted, null)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].index, 1)
  // The close is awaited, and it happened before the second probe was entered.
  assert.deepEqual(events, [
    'closing owned',
    'closed owned',
    'sample2 ownedAlive=false',
  ])
  // A process the ledger never owned is untouched.
  assert.equal(running(unowned.pid), true)
  await stopWorker(unowned)
})

test('cleanup that cannot be confirmed stops the campaign', async () => {
  let calls = 0
  const result = await runSamples({
    mode: 'scroll',
    samples: 3,
    timeoutMs: 30,
    probe: async (ownership) => {
      calls += 1
      await ownership.create(async () => ({
        close: async () => {
          throw new Error('renderer refused to close')
        },
      }))
      return new Promise(() => {})
    },
  })

  assert.equal(calls, 1)
  assert.equal(result.rows.length, 0)
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0].reason, /renderer refused to close/)
  assert.match(result.aborted, /could not be closed/)
})

test('a late rejection from an abandoned probe is absorbed', async () => {
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    let calls = 0
    const result = await runSamples({
      mode: 'typing',
      samples: 2,
      timeoutMs: 30,
      probe: async () => {
        calls += 1
        if (calls === 1) {
          await delay(80)
          throw new Error('late probe failure')
        }
        return { ok: true }
      },
    })
    await delay(150)
    assert.deepEqual(result.failed, [
      { index: 0, reason: 'typing sample 0 exceeded 0.03s' },
    ])
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].index, 1)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('a sample that leaves browser work open is dropped and stops the campaign', async () => {
  let calls = 0
  const result = await runSamples({
    mode: 'scroll',
    samples: 3,
    timeoutMs: 1000,
    probe: async () => {
      calls += 1
      return { ok: true }
    },
    // Stands in for the browser: the second sample is reported as leaving work
    // behind, so its row is not retained and the third never runs.
    confirmIdle: () => calls !== 2,
  })

  assert.equal(calls, 2)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].index, 0)
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0].reason, /left browser work open/)
  assert.match(result.aborted, /stopping the campaign/)
})

// The interaction runner puts its browser in the owned-server ledger so an
// interrupt tears it down with the spawned servers. `stopOwned` is the same
// path the SIGINT/SIGTERM handler uses, so this is the interruption case.
test('a registered resource is stopped with the owned servers', async () => {
  const owned = spawnWorker()
  const unowned = spawnWorker()
  const release = ownResource(async () => {
    await stopWorker(owned)
  })
  await stopOwned()
  assert.equal(running(owned.pid), false)
  assert.equal(running(unowned.pid), true)
  release()
  await stopWorker(unowned)
})

// Playwright browsers are not installed in CI (there is no `playwright install`
// step), so the real-browser proof runs where they are and is skipped with a
// printed note where they are not. The child-process proof above is the
// CI-gated one; this is the end-to-end check that a browser context really
// stops.
const hasBrowser = existsSync(chromium.executablePath() ?? '')
if (!hasBrowser)
  console.error(
    'probe-lifecycle: Playwright browser not installed; skipping the real-browser proof',
  )

test.runIf(hasBrowser)(
  'a timed-out probe leaves no browser context behind',
  async () => {
    const browser = await chromium.launch()
    try {
      const contexts = []
      const result = await runSamples({
        mode: 'typing',
        samples: 2,
        timeoutMs: 1500,
        probe: async (ownership) => {
          const context = await ownership.create(() => browser.newContext())
          contexts.push(context)
          const page = await context.newPage()
          await page.goto('about:blank')
          if (contexts.length === 1)
            // The renderer's main thread is the work the bound has to stop, so
            // this evaluate never resolves and the sample can only end on the
            // bound.
            await page.evaluate(() => {
              for (;;) {}
            })
          return { contextsInSample: browser.contexts().length }
        },
        confirmIdle: () => browser.contexts().length === 0,
      })
      assert.match(result.failed[0].reason, /exceeded 1\.5s/)
      assert.equal(result.rows.length, 1)
      assert.equal(result.rows[0].index, 1)
      assert.equal(contexts.length, 2)
      assert.equal(browser.contexts().includes(contexts[0]), false)
      assert.equal(browser.contexts().length, 0)
    } finally {
      await browser.close()
    }
  },
  30_000,
)
