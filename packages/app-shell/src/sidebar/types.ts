import type { ComponentType, SVGProps } from 'react'

export type SidebarDotTone = 'blue' | 'purple' | 'amber' | 'green'

export type SidebarIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface SidebarNavItem {
  badgeTone?: SidebarDotTone
  icon: {
    outline: SidebarIcon
    solid: SidebarIcon
  }
  label: string
  status?: 'live' | 'planned'
  to?: string
}

export interface SidebarMatterArtifact {
  badge: string
  icon: {
    outline: SidebarIcon
    solid: SidebarIcon
  }
  label: string
  tone: 'neutral' | 'purple' | 'green'
}
