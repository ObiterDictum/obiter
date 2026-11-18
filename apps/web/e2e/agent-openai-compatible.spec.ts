import { mkdir } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
const provider = createServer(async (request, response) => {
  const path = request.url ?? ''
  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  if (path === '/unlisted/v1/models') return reply(404, {})
  if (path.endsWith('/models'))
    return reply(200, {
      data: [
        { id: 'reasoning-model', name: 'Reasoning Model' },
        { id: 'fallback-model' },
        { id: 'unused-model', name: 'Unused Model' },
      ],
    })
  const body: {
    model: string
    reasoning_effort?: string
    messages: { content: string }[]
  } = JSON.parse(await readBody(request))
  if (body.model !== body.model.toLowerCase())
    return reply(404, {
      error: { type: 'ModelNotFound', message: 'Model not found' },
    })
  if (body.model === 'fallback-model' && body.reasoning_effort)
    return reply(400, { error: 'reasoning_effort unsupported' })
  const searched = body.messages.some((message) =>
    message.content.includes('e2e-authority:1'),
  )
  return reply(200, {
    choices: [
      {
        message: {
          content: JSON.stringify(
            searched
              ? {
                  kind: 'answer',
                  sentences: [
                    {
                      text: 'Synthetic research answer.',
                      evidenceIds: ['e2e-authority:1'],
                    },
                  ],
                }
              : {
                  kind: 'tool',
                  tool: 'search_corpus',
                  matterId: null,
                  args: {},
                },
          ),
        },
      },
    ],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 10 },
    },
  })
})
let base = ''
test.beforeAll(async () => {
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`
})
test.afterAll(
  () => new Promise<void>((resolve) => provider.close(() => resolve())),
)

test('compatible connections list models to toggle, retry unsupported thinking and persist usage', async ({
  page,
  request,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const account = await createAccount(request, 'Compatible')
  await signIn(page, account.email, account.password)
  const directory = process.env.OBITER_CONNECTION_SCREENSHOTS
  if (directory) await mkdir(directory, { recursive: true })
  async function shot(name: string) {
    if (directory)
      await page.screenshot({
        path: `${directory}/${name}.png`,
        animations: 'disabled',
      })
  }
  expect((await page.request.get('/api/agent/models')).ok()).toBe(true)
  await page.goto('/settings?section=agent')
  await expect(
    page.getByRole('button', { name: 'Add connection', exact: true }),
  ).toBeVisible()
  await shot('before-settings')
  await page
    .getByRole('button', { name: 'Add connection', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toContainText(
    "Obiter can't check what this provider keeps.",
  )
  await shot('add-connection-dialog')
  await page.getByLabel('Connection name').fill('OpenCode Go')
  await page.getByLabel('Base URL', { exact: true }).fill(`${base}/v1`)
  await page
    .getByRole('dialog')
    .getByLabel('API key', { exact: true })
    .fill('synthetic-provider-secret')
  await page
    .getByRole('button', { name: 'Save and load models', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('checkbox', { name: 'Reasoning Model (reasoning-model)' }),
  ).toBeChecked()
  await expect(dialog.getByText('3 of 3 turned on.')).toBeVisible()
  await shot('model-checklist')
  await dialog
    .getByRole('checkbox', { name: 'Unused Model (unused-model)' })
    .uncheck()
  await expect(dialog.getByText('2 of 3 turned on.')).toBeVisible()
  await shot('model-checklist-toggled')
  await page
    .getByRole('button', { name: 'Save connection', exact: true })
    .click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Connected successfully. 3 models available.',
  )
  await expect(
    page.getByRole('button', { name: 'Test', exact: true }),
  ).toBeEnabled()
  await shot('test-result')
  await page
    .getByRole('button', { name: 'Add connection', exact: true })
    .click()
  await page.getByLabel('Connection name').fill('Second gateway')
  await page.getByLabel('Base URL', { exact: true }).fill(`${base}/unlisted/v1`)
  await page
    .getByRole('dialog')
    .getByLabel('API key', { exact: true })
    .fill('synthetic-provider-secret')
  await page
    .getByRole('button', { name: 'Save and load models', exact: true })
    .click()
  await expect(dialog).toContainText('This provider does not list its models.')
  await dialog.getByLabel('Model ID').fill('Reasoning-Model')
  await dialog.getByRole('button', { name: 'Test and add' }).click()
  await expect(dialog).toContainText(
    'The provider rejected the request: Model not found',
  )
  await shot('provider-error')
  await dialog.getByLabel('Model ID').fill('reasoning-model')
  await dialog.getByRole('button', { name: 'Test and add' }).click()
  await expect(
    dialog.getByRole('checkbox', { name: 'reasoning-model' }),
  ).toBeChecked()
  await page
    .getByRole('button', { name: 'Save connection', exact: true })
    .click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await shot('settings-two-connections')
  const catalogue = await (await page.request.get('/api/agent/models')).json()
  const models = catalogue.models.filter(
    (model: { group: string }) => model.group === 'OpenCode Go',
  )
  expect(models).toHaveLength(2)
  expect(models[0]).toMatchObject({
    source: 'connection',
    recommended: false,
    provider: 'openai_compatible',
    rawModelId: 'reasoning-model',
    label: 'Reasoning Model',
  })
  await page.goto('/agent')
  await page
    .getByRole('button', {
      name: /Test model · Medium|reasoning-model · Medium/,
    })
    .click()
  await page.getByRole('radio', { name: /^Reasoning Model/ }).click()
  const pill = page.getByRole('button', { name: /Reasoning Model · Medium/ })
  await pill.click()
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking' }),
  ).toContainText('OpenCode Go')
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking' }),
  ).toContainText('Second gateway')
  await shot('composer-menu-light')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await pill.click()
  await shot('composer-menu-dark')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  const labels = {
    'reasoning-model': 'Reasoning Model',
    'fallback-model': 'fallback-model',
  }
  for (const [rawModel, label] of Object.entries(labels)) {
    await page.getByRole('button', { name: /model · Medium/i }).click()
    await page.getByRole('radio', { name: new RegExp(`^${label}`) }).click()
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill(`Explain a synthetic legal question using ${rawModel}`)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(
      page.getByText(
        `OpenCode Go · ${label} · ${rawModel === 'fallback-model' ? 'No thinking' : 'Medium thinking'}`,
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60000 })
    const id = new URL(page.url()).pathname.split('/').at(-1)
    await expect
      .poll(
        async () => {
          const detail = await (
            await page.request.get(`/api/agent-sessions/${id}`)
          ).json()
          return detail.runs.at(-1).status
        },
        { timeout: 60000 },
      )
      .toBe('completed')
    const detail = await (
      await page.request.get(`/api/agent-sessions/${id}`)
    ).json()
    const run = detail.runs.at(-1)
    expect(run.status).toBe('completed')
    expect(run.usage).toHaveLength(2)
    expect(run.usage[0]).toMatchObject({
      promptTokens: 120,
      completionTokens: 30,
      reasoningTokens: 10,
      provider: 'openai_compatible',
      connectionId: models[0].connectionId,
      modelId: rawModel,
    })
    expect(Date.parse(run.usage[0].completedAt)).toBeGreaterThanOrEqual(
      Date.parse(run.usage[0].startedAt),
    )
    expect(run.usage[0].firstTokenAt).toBeTruthy()
    await expect(page.getByRole('list', { name: 'Sources' })).toBeVisible()
    await shot(`answer-footer-${rawModel}`)
    if (rawModel === 'reasoning-model') {
      await page.goto('/agent')
      await page
        .getByRole('button', {
          name: /Test model · Medium|Reasoning Model · Medium/,
        })
        .click()
      await page.getByRole('radio', { name: /^Reasoning Model/ }).click()
    }
  }
  const refused = await page.request.post('/api/agent/connections', {
    data: {
      name: 'Private',
      baseUrl: 'https://169.254.169.254/v1',
      key: 'synthetic-provider-secret',
      modelIds: [],
      supportsReasoningEffort: true,
    },
  })
  expect(refused.status()).toBe(400)
  await page.goto('/settings?section=agent')
  await page.getByRole('button', { name: 'Edit', exact: true }).nth(1).click()
  await page.getByLabel('Connection name').fill('Renamed gateway')
  await page
    .getByRole('button', { name: 'Save connection', exact: true })
    .click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Renamed gateway', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove', exact: true }).nth(1).click()
  await expect(
    page.getByText('Renamed gateway', { exact: true }),
  ).not.toBeVisible()
  const saved = await (await page.request.get('/api/agent/connections')).json()
  expect(saved.connections).toHaveLength(1)
  expect(saved.connections[0]).not.toHaveProperty('key')
  expect(saved.connections[0]).toMatchObject({
    keyLastFour: 'cret',
    modelCount: 2,
  })
  const otherAccount = await createAccount(request, 'OtherCompatible')
  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  })
  try {
    const otherPage = await otherContext.newPage()
    await signIn(otherPage, otherAccount.email, otherAccount.password)
    const listing = await otherPage.request.get('/api/agent/connections')
    expect(listing.status()).toBe(200)
    expect(await listing.json()).toEqual({ connections: [] })
    const denied = await otherPage.request.patch(
      `/api/agent/connections/${models[0].connectionId}`,
      { data: { name: 'Cross-organisation edit' } },
    )
    expect(denied.status()).toBe(404)
  } finally {
    await otherContext.close()
  }
})
