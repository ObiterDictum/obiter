import { useCurrentUser } from '../current-user'
import { PageScaffold } from '../page-scaffold'
import { useShellContents } from '../shell-contents'
import { AccountSection } from './settings-account'
import { OrganisationSection } from './settings-organisation'
import { PreferencesSection } from './settings-preferences'
import { SecuritySection } from './settings-security'

export function SettingsRouteView() {
  const { data: me } = useCurrentUser()
  const { settingsSection: section } = useShellContents()

  return (
    <PageScaffold
      title="Settings"
      description="Your account, security and the organisation you work in."
    >
      <div className="flex max-w-[660px] flex-col gap-10">
        <AccountSection user={me.user} active={section === 'account'} />
        <SecuritySection active={section === 'security'} />
        <OrganisationSection me={me} active={section === 'organisation'} />
        <PreferencesSection active={section === 'preferences'} />
      </div>
    </PageScaffold>
  )
}
