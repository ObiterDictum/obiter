import { Switch, cn } from '@obiter/ui'
import { Info } from '@obiter/ui/icons'
import type { Integration } from '../integrations-catalogue'
import { CAPABILITY_ICONS } from './integration-capability-icons'
import { SectionHeading } from './settings-fields'

export const BARE_SWITCH =
  'shrink-0 px-0 py-0 hover:bg-transparent data-[checked]:bg-transparent aria-disabled:pointer-events-none'

function ignore() {}

export function IntegrationCapabilities({
  integration,
  enabled,
  planned,
}: {
  integration: Integration
  enabled: boolean
  planned: boolean
}) {
  return (
    <section
      aria-labelledby="integration-capabilities-heading"
      className="flex flex-col gap-4"
    >
      <SectionHeading
        id="integration-capabilities-heading"
        level="h3"
        title="What the agent can do"
        description="Each ability you allow is one the agent may use in your matters."
      />
      {planned ? (
        <p className="flex items-start gap-2 rounded-md bg-fill px-3 py-2 text-caption text-muted">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-subtle" />
          Coming with {integration.name}. These abilities switch on when it
          ships.
        </p>
      ) : null}
      <ul className="overflow-hidden rounded-lg bg-surface shadow-sm ring-1 ring-line">
        {integration.capabilities.map((capability, index) => {
          const Icon = CAPABILITY_ICONS[capability.icon]
          return (
            <li
              key={capability.title}
              className={cn(
                'flex items-center gap-3.5 px-5 py-3.5',
                index > 0 && 'border-t border-line',
              )}
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-md bg-fill text-muted"
              >
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-item text-ink">{capability.title}</p>
                <p className="text-caption text-muted">
                  {capability.description}
                </p>
              </div>
              <Switch
                label={capability.title}
                checked={enabled}
                onCheckedChange={ignore}
                disabled
                className={cn(
                  BARE_SWITCH,
                  enabled ? undefined : 'aria-disabled:opacity-45',
                )}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
