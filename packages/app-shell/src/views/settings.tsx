import { useState } from 'react'
import { GearSix, Lock, User, Users } from '@phosphor-icons/react'
import { cn } from '@obiter/ui'
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

/**
 * Settings: the account, the password, the organisation and this device's
 * preferences. Every section is mounted for the life of the route and hidden
 * rather than unmounted when it is not the active one, so a half-typed change
 * is not discarded by moving between sections. Sections that own a query pass
 * their active state down and only fetch once opened.
 *
 * The section nav is a column beside the body, and a row above it at 1024 and
 * under where a column would leave the members tables too narrow.
 */
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
          <AccountSection
            user={me.user}
            organisation={me.organisation}
            active={section === 'account'}
          />
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
