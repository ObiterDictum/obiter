import { useState } from 'react'
import type { OrganisationAgentSettings } from '@obiter/contracts'
import { Button } from '@obiter/ui'
import { thinkingName } from '../agent-models'
import { AgentModelForm } from './settings-agent-model'
import { SectionHeading } from './settings-fields'

export function AnthropicBlock({
  organisationId,
  settings,
}: {
  organisationId: string
  settings: OrganisationAgentSettings
}) {
  const configured = Boolean(settings.model && settings.keyLastFour)
  const [editing, setEditing] = useState(!configured)
  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        id="settings-agent-heading"
        level="h3"
        title="Anthropic"
        description="Your organisation's own Anthropic account, and the default model for new conversations."
      />
      {editing || !settings.model || !settings.keyLastFour ? (
        <AgentModelForm
          key={[
            settings.model?.provider,
            settings.model?.modelId,
            settings.model?.snapshot,
            settings.keySetAt,
          ].join('|')}
          organisationId={organisationId}
          settings={settings}
          onDone={configured ? () => setEditing(false) : undefined}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="text-item text-ink">{settings.model.modelId}</div>
            <div className="text-caption text-muted">
              {`${thinkingName(settings.thinking ?? 'off')} thinking · Key ending ${settings.keyLastFour}`}
            </div>
          </div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
    </div>
  )
}
