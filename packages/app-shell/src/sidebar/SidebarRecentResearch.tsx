import {
  ChevronDownIcon as ChevronDownIconOutline,
  DocumentTextIcon as DocumentTextIconOutline,
  MagnifyingGlassIcon as MagnifyingGlassIconOutline,
  SparklesIcon as SparklesIconOutline,
} from '@heroicons/react/24/outline'
import {
  ChevronDownIcon as ChevronDownIconSolid,
  DocumentTextIcon as DocumentTextIconSolid,
  MagnifyingGlassIcon as MagnifyingGlassIconSolid,
  SparklesIcon as SparklesIconSolid,
} from '@heroicons/react/24/solid'
import { useState } from 'react'

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
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section className="ormont-sidebar-research" aria-labelledby="recent-research-title">
      <button
        aria-expanded={!collapsed}
        className="ormont-sidebar-section-toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span id="recent-research-title">Recent Research</span>
        <span className="ormont-sidebar-section-toggle__icon-wrap" aria-hidden="true">
          <ChevronDownIconOutline className="ormont-sidebar-section-toggle__icon" />
          <ChevronDownIconSolid className="ormont-sidebar-section-toggle__icon ormont-sidebar-section-toggle__icon--solid" />
        </span>
      </button>

      <div className="ormont-sidebar-research__list" hidden={collapsed}>
        {recentResearchItems.map((item) => {
          const OutlineIcon = item.icon.outline
          const SolidIcon = item.icon.solid
          return (
            <button className="ormont-sidebar-research__item" key={item.label} type="button">
              <span className="ormont-sidebar-research__icon-wrap" aria-hidden="true">
                <OutlineIcon className="ormont-sidebar-research__icon" />
                <SolidIcon className="ormont-sidebar-research__icon ormont-sidebar-research__icon--solid" />
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
