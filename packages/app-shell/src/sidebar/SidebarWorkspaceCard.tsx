import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'

interface SidebarWorkspaceCardProps {
  mode: 'active' | 'last-active'
}

export function SidebarWorkspaceCard({ mode }: SidebarWorkspaceCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const label = mode === 'last-active' ? 'Last active matter' : 'Active matter'

  return (
    <section className="ormont-sidebar-workspace" aria-label={label}>
      <button
        aria-expanded={!collapsed}
        className="ormont-sidebar-workspace__button"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span>
          <em>{label}</em>
          <strong>Horizon v Secretary of State</strong>
          <span>England &amp; Wales</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className="ormont-sidebar-workspace__chevron" />
      </button>

      <div className="ormont-sidebar-workspace__details" hidden={collapsed}>
        <span className="ormont-sidebar-workspace__status">
          <span aria-hidden="true" />
          Local redaction ready
        </span>
      </div>
    </section>
  )
}
