import { Collapsible } from '@base-ui-components/react/collapsible'
import { ChevronDownIcon } from '@heroicons/react/24/outline'

interface SidebarWorkspaceCardProps {
  mode: 'active' | 'last-active'
}

export function SidebarWorkspaceCard({ mode }: SidebarWorkspaceCardProps) {
  const label = mode === 'last-active' ? 'Last active matter' : 'Active matter'

  return (
    <section className="ormont-sidebar-workspace" aria-label={label}>
      <Collapsible.Root defaultOpen>
        <Collapsible.Trigger className="ormont-sidebar-workspace__button" type="button">
          <span>
            <em>{label}</em>
            <strong>Horizon v Secretary of State</strong>
            <span>England &amp; Wales</span>
          </span>
          <ChevronDownIcon aria-hidden="true" className="ormont-sidebar-workspace__chevron" />
        </Collapsible.Trigger>

        <Collapsible.Panel className="ormont-sidebar-workspace__details" keepMounted>
          <span className="ormont-sidebar-workspace__status">
            <span aria-hidden="true" />
            Local redaction ready
          </span>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  )
}
