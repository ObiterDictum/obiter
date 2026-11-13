import { useCurrentUser } from '../current-user'
import { PageScaffold } from '../page-scaffold'
import { SETTINGS_SECTIONS, useSettingsSection } from '../settings-sections'
import { AccountSection } from './settings-account'
import { AgentSection } from './settings-agent'
import { MembersSection } from './settings-members'
import { OrganisationSection } from './settings-organisation'
import { PreferencesSection } from './settings-preferences'
import { SecuritySection } from './settings-security'

export function SettingsRouteView() {
  const { data: me } = useCurrentUser()
  const section = useSettingsSection(me)
  const current =
    SETTINGS_SECTIONS.find((item) => item.id === section) ??
    SETTINGS_SECTIONS[0]

  return (
    <PageScaffold title={current.label} description={current.description}>
      <AccountSection user={me.user} active={section === 'account'} />
      <SecuritySection active={section === 'security'} />
      <PreferencesSection active={section === 'preferences'} />
      <OrganisationSection me={me} active={section === 'organisation'} />
      <MembersSection me={me} active={section === 'members'} />
      <AgentSection me={me} active={section === 'agent'} />
    </PageScaffold>
  )
}
