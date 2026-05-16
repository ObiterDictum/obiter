import {
  DocumentTextIcon as DocumentTextIconOutline,
  MagnifyingGlassIcon as MagnifyingGlassIconOutline,
  SparklesIcon as SparklesIconOutline,
} from '@heroicons/react/24/outline'
import {
  DocumentTextIcon as DocumentTextIconSolid,
  MagnifyingGlassIcon as MagnifyingGlassIconSolid,
  SparklesIcon as SparklesIconSolid,
} from '@heroicons/react/24/solid'
import { SidebarDisclosure } from '../components/SidebarDisclosure'
import { SidebarIconPair } from '../components/SidebarIconPair'

const recentResearchItems = [
  {
    detail: 'Updated 12 min ago',
    icon: { outline: MagnifyingGlassIconOutline, solid: MagnifyingGlassIconSolid },
    label: 'Disclosure duties in public law',
  },
  {
    detail: '4 sources',
    icon: { outline: DocumentTextIconOutline, solid: DocumentTextIconSolid },
    label: 'Anxious scrutiny authorities',
  },
  {
    detail: 'Draft answer',
    icon: { outline: SparklesIconOutline, solid: SparklesIconSolid },
    label: 'Relief after procedural unfairness',
  },
] as const

export function SidebarRecentResearch() {
  return (
    <section className="ormont-sidebar-research" aria-labelledby="recent-research-title">
      <SidebarDisclosure
        panelClassName="ormont-sidebar-research__list"
        title="Recent Research"
        titleId="recent-research-title"
      >
        {recentResearchItems.map((item) => (
          <button className="ormont-sidebar-research__item" key={item.label} type="button">
            <span className="ormont-sidebar-research__icon-wrap" aria-hidden="true">
              <SidebarIconPair
                className="ormont-sidebar-research__icon"
                icon={item.icon}
                solidClassName="ormont-sidebar-research__icon--solid"
              />
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </SidebarDisclosure>
    </section>
  )
}
