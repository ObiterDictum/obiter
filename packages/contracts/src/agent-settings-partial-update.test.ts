import { describe, expect, it } from 'bun:test'
import { agentSessionSettingsUpdateSchema } from './agent-settings'

const managedModel = {
  provider: 'obiter_eu',
  modelId: 'managed-small',
  snapshot: null,
}

const externalModel = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-5',
  snapshot: null,
}

describe('agent session settings partial update provider rules', () => {
  it('checks each supplied model against managed access when its peer is omitted', () => {
    for (const patch of [
      { accessMode: 'managed_eu', model: externalModel },
      { accessMode: 'managed_eu', fastModel: externalModel },
      {
        accessMode: 'managed_eu',
        model: managedModel,
        fastModel: externalModel,
      },
      {
        accessMode: 'managed_eu',
        model: externalModel,
        fastModel: managedModel,
      },
    ]) {
      expect(agentSessionSettingsUpdateSchema.safeParse(patch).success).toBe(
        false,
      )
    }
  })

  it('checks each supplied model against BYOK access when its peer is omitted', () => {
    for (const patch of [
      { accessMode: 'byok', model: managedModel },
      { accessMode: 'byok', fastModel: managedModel },
      {
        accessMode: 'byok',
        model: externalModel,
        fastModel: managedModel,
      },
      {
        accessMode: 'byok',
        model: managedModel,
        fastModel: externalModel,
      },
    ]) {
      expect(agentSessionSettingsUpdateSchema.safeParse(patch).success).toBe(
        false,
      )
    }
  })

  it('rejects either external model under strict lockdown without an access mode', () => {
    for (const patch of [
      { strictLockdown: true, model: externalModel },
      { strictLockdown: true, fastModel: externalModel },
      {
        strictLockdown: true,
        model: managedModel,
        fastModel: externalModel,
      },
      {
        strictLockdown: true,
        model: externalModel,
        fastModel: managedModel,
      },
    ]) {
      expect(agentSessionSettingsUpdateSchema.safeParse(patch).success).toBe(
        false,
      )
    }
  })

  it('rejects BYOK and disabled access when strict lockdown is enabled', () => {
    for (const accessMode of ['byok', 'disabled']) {
      expect(
        agentSessionSettingsUpdateSchema.safeParse({
          strictLockdown: true,
          accessMode,
        }).success,
      ).toBe(false)
    }
  })

  it('accepts compatible managed and external BYOK model choices', () => {
    for (const patch of [
      { accessMode: 'managed_eu', model: managedModel },
      { accessMode: 'managed_eu', fastModel: managedModel },
      { strictLockdown: true, model: managedModel },
      { strictLockdown: true, fastModel: managedModel },
      {
        accessMode: 'managed_eu',
        model: managedModel,
        fastModel: managedModel,
      },
      { accessMode: 'byok', model: externalModel },
      { accessMode: 'byok', fastModel: externalModel },
      {
        accessMode: 'byok',
        model: externalModel,
        fastModel: externalModel,
      },
    ]) {
      expect(agentSessionSettingsUpdateSchema.safeParse(patch).success).toBe(
        true,
      )
    }
  })

  it('accepts null fast model and one-sided choices when mode and lockdown are omitted', () => {
    for (const patch of [
      { fastModel: null },
      { model: managedModel },
      { model: externalModel },
      { fastModel: managedModel },
      { fastModel: externalModel },
    ]) {
      expect(agentSessionSettingsUpdateSchema.safeParse(patch).success).toBe(
        true,
      )
    }
  })
})
