import { useState } from 'react'
import { useCurrentUser } from '../current-user'
import { AccountSection } from './settings-account'
import { OrganisationSection } from './settings-organisation'
import { SecuritySection } from './settings-security'

const SECTIONS = ['account', 'security', 'organisation'] as const
export type SettingsSection = (typeof SECTIONS)[number]

const SECTION_LABELS: Record<SettingsSection, string> = {
  account: 'Account',
  security: 'Security',
  organisation: 'Organisation',
}

/**
 * Settings: the account, the password and the organisation. Every section is
 * mounted for the life of the route and hidden rather than unmounted when it is
 * not the active one, so a half-typed change is not discarded by moving between
 * sections. Sections that own a query pass their active state down and only
 * fetch once opened.
 */
export function SettingsRouteView() {
  const { data: me } = useCurrentUser()
  const [section, setSection] = useState<SettingsSection>('account')

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your account, your password, and the organisation you work in.
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6 md:flex-row md:gap-10">
        <SettingsSectionNav active={section} onSelect={setSection} />
        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <AccountSection
            user={me.user}
            organisation={me.organisation}
            active={section === 'account'}
          />
          <SecuritySection active={section === 'security'} />
          <OrganisationSection me={me} active={section === 'organisation'} />
        </div>
      </div>
    </div>
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
    <nav aria-label="Settings sections" className="md:w-40 md:shrink-0">
      <ul className="flex flex-row gap-1 md:flex-col md:gap-0.5">
        {SECTIONS.map((section) => (
          <li key={section} className="flex-1 md:flex-none">
            <button
              type="button"
              aria-current={section === active ? 'true' : undefined}
              onClick={() => onSelect(section)}
              className={
                section === active
                  ? 'w-full rounded-md bg-surface px-3 py-2 text-left text-sm font-medium text-ink'
                  : 'w-full rounded-md px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface hover:text-ink'
              }
            >
              {SECTION_LABELS[section]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** A value the product reads out but does not let anyone edit here. */
