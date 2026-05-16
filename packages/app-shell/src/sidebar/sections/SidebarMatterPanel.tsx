import {
  DocumentTextIcon as DocumentTextIconOutline,
  EyeIcon as EyeIconOutline,
  ShieldCheckIcon as ShieldCheckIconOutline,
} from '@heroicons/react/24/outline'
import {
  DocumentTextIcon as DocumentTextIconSolid,
  EyeIcon as EyeIconSolid,
  ShieldCheckIcon as ShieldCheckIconSolid,
} from '@heroicons/react/24/solid'
import { SidebarDisclosure } from '../components/SidebarDisclosure'
import { SidebarIconPair } from '../components/SidebarIconPair'
import type { SidebarMatterArtifact } from '../types'

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
  return (
    <section className="ormont-sidebar-matter" aria-labelledby="current-matter-title">
      <SidebarDisclosure
        panelClassName="ormont-sidebar-matter__list"
        title="Current Matter"
        titleId="current-matter-title"
      >
        {matterArtifacts.map((artifact) => (
          <button
            className="ormont-sidebar-matter__item"
            data-tone={artifact.tone}
            key={artifact.label}
            type="button"
          >
            <span className="ormont-sidebar-matter__icon-wrap" aria-hidden="true">
              <SidebarIconPair
                className="ormont-sidebar-matter__icon"
                icon={artifact.icon}
                solidClassName="ormont-sidebar-matter__icon--solid"
              />
            </span>
            <span>{artifact.label}</span>
            <strong>{artifact.badge}</strong>
          </button>
        ))}
      </SidebarDisclosure>
    </section>
  )
}
