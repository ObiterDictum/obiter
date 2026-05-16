import type { ComponentType, SVGProps } from 'react'

export type SidebarDotTone = 'blue' | 'purple' | 'amber' | 'green'

export type SidebarIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface SidebarIconSet {
  outline: SidebarIcon
  solid: SidebarIcon
}

export interface SidebarNavItem {
  badgeTone?: SidebarDotTone
  icon: SidebarIconSet
  label: string
  to?: string
}

export interface SidebarNavSection {
  items: SidebarNavItem[]
  label?: string
}

export interface SidebarMatterArtifact {
  badge: string
  icon: SidebarIconSet
  label: string
  tone: 'neutral' | 'purple' | 'green'
}
