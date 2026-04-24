import {
  ChevronDownIcon as ChevronDownIconOutline,
  DocumentTextIcon as DocumentTextIconOutline,
  EyeIcon as EyeIconOutline,
  ShieldCheckIcon as ShieldCheckIconOutline,
} from '@heroicons/react/24/outline'
import {
  ChevronDownIcon as ChevronDownIconSolid,
  DocumentTextIcon as DocumentTextIconSolid,
  EyeIcon as EyeIconSolid,
  ShieldCheckIcon as ShieldCheckIconSolid,
} from '@heroicons/react/24/solid'
import { useState } from 'react'
import type { SidebarMatterArtifact } from './types'

const matterArtifacts: SidebarMatterArtifact[] = [
  {
    badge: '18 items',
    icon: { outline: DocumentTextIconOutline, solid: DocumentTextIconSolid },
    label: 'Draft skeleton argument',
    tone: 'neutral',
  },
  {
    badge: '7 risks',
    icon: { outline: EyeIconOutline, solid: EyeIconSolid },
    label: 'Redaction review',
    tone: 'purple',
  },
  {
    badge: 'Ready',
    icon: { outline: ShieldCheckIconOutline, solid: ShieldCheckIconSolid },
    label: 'Verification report',
    tone: 'green',
  },
]

export function SidebarMatterPanel() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section className="ormont-sidebar-matter" aria-labelledby="current-matter-title">
      <button
        aria-expanded={!collapsed}
        className="ormont-sidebar-section-toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span id="current-matter-title">Current Matter</span>
        <span className="ormont-sidebar-section-toggle__icon-wrap" aria-hidden="true">
          <ChevronDownIconOutline className="ormont-sidebar-section-toggle__icon" />
          <ChevronDownIconSolid className="ormont-sidebar-section-toggle__icon ormont-sidebar-section-toggle__icon--solid" />
        </span>
      </button>

      <div className="ormont-sidebar-matter__list" hidden={collapsed}>
        {matterArtifacts.map((artifact) => {
          const OutlineIcon = artifact.icon.outline
          const SolidIcon = artifact.icon.solid
          return (
            <button
              className="ormont-sidebar-matter__item"
              data-tone={artifact.tone}
              key={artifact.label}
              type="button"
            >
              <span className="ormont-sidebar-matter__icon-wrap" aria-hidden="true">
                <OutlineIcon className="ormont-sidebar-matter__icon" />
                <SolidIcon className="ormont-sidebar-matter__icon ormont-sidebar-matter__icon--solid" />
              </span>
              <span>{artifact.label}</span>
              <strong>{artifact.badge}</strong>
            </button>
          )
        })}
      </div>
    </section>
  )
}
