import { describe, expect, it } from 'bun:test'
import {
  AGENT_PROVIDERS,
  agentModelChoiceSchema,
  organisationAgentSettingsSchema,
  organisationAgentSettingsUpdateSchema,
} from './agent-settings'

const stored = {
  matterTextToModel: false,
  model: {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-5',
    snapshot: 'claude-sonnet-4-5-20250929',
  },
  keyLastFour: 'x9Qa',
  keySetAt: '2026-11-04T09:30:00.000Z',
}

describe('agent model choice', () => {
  it('accepts only a provider on the list', () => {
    expect(
      agentModelChoiceSchema.safeParse({ ...stored.model, provider: 'acme' })
        .success,
    ).toBe(false)
    expect(Object.keys(AGENT_PROVIDERS)).toEqual(['anthropic'])
  })

  it('rejects a model id that does not match the provider format', () => {
    for (const modelId of ['gpt-5', 'Claude Sonnet', 'claude-', '']) {
      expect(
        agentModelChoiceSchema.safeParse({ ...stored.model, modelId }).success,
      ).toBe(false)
    }
  })

  it('checks the snapshot against the same format and allows none', () => {
    expect(
      agentModelChoiceSchema.safeParse({ ...stored.model, snapshot: 'latest' })
        .success,
    ).toBe(false)
    expect(
      agentModelChoiceSchema.parse({ ...stored.model, snapshot: null })
        .snapshot,
    ).toBeNull()
  })

  it('trims surrounding whitespace from a pasted model id', () => {
    expect(
      agentModelChoiceSchema.parse({
        ...stored.model,
        modelId: '  claude-opus-4-1 ',
      }).modelId,
    ).toBe('claude-opus-4-1')
  })
})

describe('organisation agent settings response', () => {
  it('carries the last four characters of a stored key, never the key', () => {
    expect(organisationAgentSettingsSchema.parse(stored).keyLastFour).toBe(
      'x9Qa',
    )
    expect(
      organisationAgentSettingsSchema.safeParse({
        ...stored,
        key: 'sk-ant-secret',
      }).success,
    ).toBe(false)
  })

  it('a key without its set date is rejected', () => {
    expect(
      organisationAgentSettingsSchema.safeParse({ ...stored, keySetAt: null })
        .success,
    ).toBe(false)
  })

  it('an organisation with nothing configured has no model and no key', () => {
    expect(
      organisationAgentSettingsSchema.safeParse({
        matterTextToModel: false,
        model: null,
        keyLastFour: null,
        keySetAt: null,
      }).success,
    ).toBe(true)
  })
})

describe('organisation agent settings update', () => {
  it('replaces the key with a pasted value', () => {
    const update = organisationAgentSettingsUpdateSchema.parse({
      model: stored.model,
      key: { action: 'replace', value: 'sk-ant-api03-abcdefghijklmnop' },
    })
    expect(update.key).toEqual({
      action: 'replace',
      value: 'sk-ant-api03-abcdefghijklmnop',
    })
  })

  it('removes the key without sending one', () => {
    expect(
      organisationAgentSettingsUpdateSchema.safeParse({
        key: { action: 'remove' },
      }).success,
    ).toBe(true)
  })

  it('rejects a key that is too short or contains whitespace', () => {
    for (const value of ['short', 'sk-ant-api03 abcdefghijklmnop']) {
      expect(
        organisationAgentSettingsUpdateSchema.safeParse({
          key: { action: 'replace', value },
        }).success,
      ).toBe(false)
    }
  })

  it('still accepts the matter documents switch on its own', () => {
    expect(
      organisationAgentSettingsUpdateSchema.safeParse({
        matterTextToModel: true,
      }).success,
    ).toBe(true)
  })

  it('an empty update is rejected', () => {
    expect(organisationAgentSettingsUpdateSchema.safeParse({}).success).toBe(
      false,
    )
  })
})
