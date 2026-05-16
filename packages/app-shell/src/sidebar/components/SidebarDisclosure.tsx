import { Collapsible } from '@base-ui-components/react/collapsible'
import {
  ChevronDownIcon as ChevronDownIconOutline,
} from '@heroicons/react/24/outline'
import {
  ChevronDownIcon as ChevronDownIconSolid,
} from '@heroicons/react/24/solid'
import type { ReactNode } from 'react'

interface SidebarDisclosureProps {
  children: ReactNode
  defaultOpen?: boolean
  panelClassName: string
  title: ReactNode
  titleId?: string
}

export function SidebarDisclosure({
  children,
  defaultOpen = true,
  panelClassName,
  title,
  titleId,
}: SidebarDisclosureProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="ormont-sidebar-section-toggle" type="button">
        <span id={titleId}>{title}</span>
        <span className="ormont-sidebar-section-toggle__icon-wrap" aria-hidden="true">
          <ChevronDownIconOutline className="ormont-sidebar-section-toggle__icon" />
          <ChevronDownIconSolid className="ormont-sidebar-section-toggle__icon ormont-sidebar-section-toggle__icon--solid" />
        </span>
      </Collapsible.Trigger>

      <Collapsible.Panel className={panelClassName} keepMounted>
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
