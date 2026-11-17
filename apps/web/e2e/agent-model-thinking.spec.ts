import { agentModelOption } from './agent-controls'
import { mkdir } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { openMatter } from './support'

test('one menu carries the model and Think longer, and the answer records the level', async ({
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
  const workspace = page.getByRole('navigation', { name: 'Workspace' })
  await shot('sidebar-agent-active')
  if (directory)
    await workspace.screenshot({
      animations: 'disabled',
      path: `${directory}/sidebar-icon-active.png`,
    })
  await page.getByRole('button', { name: 'Test model', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking' }),
  ).toBeVisible()
  await expect(agentModelOption(page, /Test model/)).toBeChecked()
  await shot('composer-menu-light')
  const thinkLonger = page.getByRole('switch', { name: 'Think longer' })
  await expect(thinkLonger).not.toBeChecked()
  await thinkLonger.click()
  await expect(thinkLonger).toBeChecked()
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking' }),
  ).toBeVisible()
  await shot('composer-menu-think-longer')
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', {
      name: 'Test model · Think longer',
      exact: true,
    }),
  ).toBeVisible()
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
    page.getByText('Test model · Thought longer', { exact: true }),
  ).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('list', { name: 'Sources' })).toBeVisible({
    timeout: 60000,
  })
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled()
  await shot('answer-footer')
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
    page.getByRole('button', {
      name: 'Test model · Think longer',
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page.getByRole('button', { name: 'Test model · Think longer' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking' }),
  ).toBeVisible()
  await shot('composer-menu-dark')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await openMatter(page, 'Model selection synthetic matter')
  await shot('sidebar-agent-normal')
  if (directory)
    await workspace.screenshot({
      animations: 'disabled',
      path: `${directory}/sidebar-icon-normal.png`,
    })
  await page.getByRole('button', { name: 'Show agent panel' }).click()
  await page.getByRole('button', { name: 'Test model', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Model and thinking' }),
  ).toBeVisible()
  await shot('matter-panel-menu')
  await page.keyboard.press('Escape')
  await page.goto('/settings?section=agent')
  await page.getByLabel('Model', { exact: true }).fill('e2e-scripted')
  const thinkLongerByDefault = page.getByRole('switch', {
    name: 'Think longer by default',
    exact: true,
  })
  await expect(thinkLongerByDefault).not.toBeChecked()
  await thinkLongerByDefault.click()
  await expect(thinkLongerByDefault).toBeChecked()
  await shot('settings-agent')
})
