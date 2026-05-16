import type { SidebarIconSet } from '../types'

interface SidebarIconPairProps {
  className: string
  icon: SidebarIconSet
  solidClassName: string
}

export function SidebarIconPair({ className, icon, solidClassName }: SidebarIconPairProps) {
  const OutlineIcon = icon.outline
  const SolidIcon = icon.solid

  return (
    <>
      <OutlineIcon className={className} />
      <SolidIcon className={`${className} ${solidClassName}`} />
    </>
  )
}
