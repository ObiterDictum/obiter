import { mkdir } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'

test('compatible connections discover models, retry unsupported thinking and persist usage', async ({
  page,
  request,
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
  await page.goto('/settings?section=agent')
  await page
    .getByRole('button', { name: 'Add connection', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toContainText(
    "Obiter can't check what this provider keeps.",
  )
  await shot('add-connection-dialog')
  await page.getByLabel('Connection name').fill('OpenCode Go')
  await page
    .getByLabel('Base URL', { exact: true })
    .fill('http://127.0.0.1:8967/v1')
  await page
    .getByLabel('API key', { exact: true })
    .fill('synthetic-provider-secret')
  await page
    .getByRole('button', { name: 'Save connection', exact: true })
    .click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Connected successfully. 2 models available.',
  )
  await shot('test-result')
  await page
    .getByRole('button', { name: 'Add connection', exact: true })
    .click()
  await page.getByLabel('Connection name').fill('Second gateway')
  await page
    .getByLabel('Base URL', { exact: true })
    .fill('http://127.0.0.1:8967/v1')
  await page
    .getByLabel('API key', { exact: true })
    .fill('synthetic-provider-secret')
  await page
    .getByLabel('Model ids (comma separated, optional)')
    .fill('reasoning-model')
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
  })
  await page.goto('/agent')
  await page.getByRole('button', { name: 'New session', exact: true }).count()
  const pill = page.getByRole('button', { name: /reasoning-model · Medium/ })
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
  for (const rawModel of ['reasoning-model', 'fallback-model']) {
    await page.getByRole('button', { name: /model · Medium/ }).click()
    await page
      .getByRole('radio', { name: new RegExp(`${rawModel} OpenCode Go`) })
      .click()
    await page
      .getByRole('textbox', { name: 'Message' })
      .fill(`Explain a synthetic legal question using ${rawModel}`)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(
      page.getByText(
        `OpenCode Go · ${rawModel} · ${rawModel === 'fallback-model' ? 'No thinking' : 'Medium thinking'}`,
        { exact: true },
      ),
    ).toBeVisible({ timeout: 60000 })
    const id = new URL(page.url()).pathname.split('/').at(-1)
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
    await shot(`answer-footer-${rawModel}`)
    if (rawModel === 'reasoning-model') await page.goto('/agent')
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
})
