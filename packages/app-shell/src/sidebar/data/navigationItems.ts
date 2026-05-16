import {
  BeakerIcon as BeakerIconOutline,
  BellAlertIcon as BellAlertIconOutline,
  BuildingLibraryIcon as BuildingLibraryIconOutline,
  CircleStackIcon as CircleStackIconOutline,
  ClockIcon as ClockIconOutline,
  CodeBracketIcon as CodeBracketIconOutline,
  DocumentArrowUpIcon as DocumentArrowUpIconOutline,
  DocumentTextIcon as DocumentTextIconOutline,
  EyeSlashIcon as EyeSlashIconOutline,
  FolderIcon as FolderIconOutline,
  GlobeAltIcon as GlobeAltIconOutline,
  ShieldCheckIcon as ShieldCheckIconOutline,
  Squares2X2Icon as Squares2X2IconOutline,
} from '@heroicons/react/24/outline'
import {
  BeakerIcon as BeakerIconSolid,
  BellAlertIcon as BellAlertIconSolid,
  BuildingLibraryIcon as BuildingLibraryIconSolid,
  CircleStackIcon as CircleStackIconSolid,
  ClockIcon as ClockIconSolid,
  CodeBracketIcon as CodeBracketIconSolid,
  DocumentArrowUpIcon as DocumentArrowUpIconSolid,
  DocumentTextIcon as DocumentTextIconSolid,
  EyeSlashIcon as EyeSlashIconSolid,
  FolderIcon as FolderIconSolid,
  GlobeAltIcon as GlobeAltIconSolid,
  ShieldCheckIcon as ShieldCheckIconSolid,
  Squares2X2Icon as Squares2X2IconSolid,
} from '@heroicons/react/24/solid'
import type { SidebarNavSection } from '../types'

export const navSections: SidebarNavSection[] = [
  {
    items: [
      { icon: { outline: Squares2X2IconOutline, solid: Squares2X2IconSolid }, label: 'Dashboard', to: '/workspace' },
      { icon: { outline: DocumentTextIconOutline, solid: DocumentTextIconSolid }, label: 'Draft' },
      { badgeTone: 'blue', icon: { outline: BeakerIconOutline, solid: BeakerIconSolid }, label: 'Research' },
      { icon: { outline: FolderIconOutline, solid: FolderIconSolid }, label: 'Matters', to: '/matters' },
    ],
  },
  {
    label: 'Evidence & Review',
    items: [
      { icon: { outline: CircleStackIconOutline, solid: CircleStackIconSolid }, label: 'Documents' },
      { icon: { outline: GlobeAltIconOutline, solid: GlobeAltIconSolid }, label: 'Authorities' },
      { badgeTone: 'purple', icon: { outline: EyeSlashIconOutline, solid: EyeSlashIconSolid }, label: 'Redact' },
      { badgeTone: 'amber', icon: { outline: ShieldCheckIconOutline, solid: ShieldCheckIconSolid }, label: 'Verify' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { icon: { outline: BellAlertIconOutline, solid: BellAlertIconSolid }, label: 'Review Queue' },
      { icon: { outline: ClockIconOutline, solid: ClockIconSolid }, label: 'Deadlines' },
      { icon: { outline: DocumentArrowUpIconOutline, solid: DocumentArrowUpIconSolid }, label: 'Upload' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { icon: { outline: BuildingLibraryIconOutline, solid: BuildingLibraryIconSolid }, label: 'Bench' },
      { icon: { outline: CodeBracketIconOutline, solid: CodeBracketIconSolid }, label: 'API' },
    ],
  },
]
