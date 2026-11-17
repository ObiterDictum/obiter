import { agentModelOption } from './agent-controls'
import { mkdir } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { openMatter } from './support'

test('model and thinking selection is sent, recorded, remembered and shown on answers', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const account = await createAccount(request, 'ModelThinking')
  await signIn(page, account.email, account.password)
  await page.goto('/agent')
  const directory = process.env.OBITER_MODEL_SCREENSHOTS
  if (directory) await mkdir(directory, { recursive: true })
  async function shot(name: string) {
    if (directory)
      await page.screenshot({
        animations: 'disabled',
        path: `${directory}/${name}.png`,
      })
  }
  await page.getByRole('button', { name: 'Test model', exact: true }).click()
  await expect(agentModelOption(page, /Test model/)).toBeVisible()
  await shot('composer-model-menu')
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: 'Thinking', exact: true }).click()
  await shot('thinking-control')
  await page.getByRole('option', { name: 'High', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Explain the duty of care')
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith('/turns') && request.method() === 'POST',
  )
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  expect((await sent).postDataJSON()).toMatchObject({
    model: 'e2e-scripted',
    thinking: 'high',
  })
  await expect(
    page.getByText('Test model · Thinking high', { exact: true }),
  ).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('list', { name: 'Sources' })).toBeVisible({
    timeout: 60000,
  })
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled()
  await shot('turn-footer')
  const id = new URL(page.url()).pathname.split('/').at(-1)
  const detail = await (
    await page.request.get(`/api/agent-sessions/${id}`)
  ).json()
  expect(detail.session).toMatchObject({
    model: 'e2e-scripted',
    thinking: 'high',
  })
  expect(detail.runs[0]).toMatchObject({
    thinking: 'high',
    modelLabel: 'Test model',
    versions: { model: { modelId: 'e2e-scripted' } },
  })
  const refused = await page.request.post(`/api/agent-sessions/${id}/turns`, {
    data: {
      kind: 'follow_up',
      text: 'Refuse this model',
      idempotencyKey: crypto.randomUUID(),
      model: 'disallowed',
      thinking: 'high',
    },
  })
  expect(refused.status()).toBe(400)
  expect(await refused.json()).toMatchObject({
    error: { code: 'validation_failed' },
  })
  await page.reload()
  await expect(
    page.getByRole('combobox', { name: 'Thinking', exact: true }),
  ).toContainText('High')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await shot('dark-composer')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await openMatter(page, 'Model selection synthetic matter')
  await page.getByRole('button', { name: 'Show agent panel' }).click()
  await page
    .getByRole('button', { name: 'Test model · medium', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking' }),
  ).toBeVisible()
  await shot('matter-panel-popover')
  await page.keyboard.press('Escape')
  await page.goto('/settings?tab=agent')
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Default thinking', exact: true }),
  ).toBeVisible()
  await shot('settings-agent')
})
