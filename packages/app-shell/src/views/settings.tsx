import { useState } from 'react'
import { cn } from '@obiter/ui'
import { GearSix, Lock, User, Users } from '@obiter/ui/icons'
import { useCurrentUser } from '../current-user'
import { PageScaffold } from '../page-scaffold'
import { AccountSection } from './settings-account'
import { OrganisationSection } from './settings-organisation'
import { PreferencesSection } from './settings-preferences'
import { SecuritySection } from './settings-security'

const SECTIONS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'organisation', label: 'Organisation', icon: Users },
  { id: 'preferences', label: 'Preferences', icon: GearSix },
] as const

type SettingsSection = (typeof SECTIONS)[number]['id']

export function SettingsRouteView() {
  const { data: me } = useCurrentUser()
  const [section, setSection] = useState<SettingsSection>('account')

  return (
    <PageScaffold
      title="Settings"
      description="Your account, security and the organisation you work in."
    >
      <div className="grid gap-6 compact:grid-cols-[200px_minmax(0,1fr)] compact:gap-12">
        <SettingsSectionNav active={section} onSelect={setSection} />
        <div className="flex min-w-0 max-w-[660px] flex-col gap-10">
          <AccountSection user={me.user} active={section === 'account'} />
          <SecuritySection active={section === 'security'} />
          <OrganisationSection me={me} active={section === 'organisation'} />
          <PreferencesSection active={section === 'preferences'} />
        </div>
      </div>
    </PageScaffold>
  )
}

function SettingsSectionNav({
  active,
  onSelect,
}: {
  active: SettingsSection
  onSelect: (section: SettingsSection) => void
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="compact:sticky compact:top-0 compact:self-start"
    >
      <ul className="flex flex-row flex-wrap gap-1 compact:flex-col">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <li key={id} className="min-w-0">
            <button
              type="button"
              aria-current={id === active ? 'true' : undefined}
              onClick={() => onSelect(id)}
              className={cn(
                'flex h-8 items-center gap-3 rounded-md px-3 text-meta whitespace-nowrap',
                'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                'compact:w-full',
                id === active
                  ? 'bg-fill text-ink'
                  : 'text-muted hover:bg-hover hover:text-ink',
              )}
            >
              <Icon size={16} aria-hidden className="shrink-0 opacity-85" />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
