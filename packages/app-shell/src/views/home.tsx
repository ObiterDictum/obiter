import { Link, useNavigate } from '@tanstack/react-router'
import { Clock, X } from '@phosphor-icons/react'
import type { AppPlatform } from '@ormont/contracts'
import { useState, type FormEvent } from 'react'
import { changelogQueryOptions } from '../changelog'
import {
  canSeeDevelopmentStatus,
  demoCurrentUserQueryOptions,
  shellSnapshotQueryOptions,
} from '../fixtures'
import { useSuspenseQuery } from '@tanstack/react-query'

/**
 * Home — still the Phase 0 fixture view (M2 rewires to real data). Kept verbatim
 * apart from the icon pack swap (Phosphor) so it keeps rendering during M1.
 */
export function HomeRouteView({ platform }: { platform: AppPlatform }) {
  const navigate = useNavigate()
  const [homeSearch, setHomeSearch] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const { data } = useSuspenseQuery(shellSnapshotQueryOptions(platform))
  const { data: me } = useSuspenseQuery(demoCurrentUserQueryOptions())
  const { data: changelog } = useSuspenseQuery(changelogQueryOptions())
  const activeMilestone = data.milestones.find((milestone) => milestone.status === 'active')
  const matterCount = data.matters.length
  const attentionItems = [
    {
      label: 'Review queue',
      status: 'Planned',
      detail: 'Document review, redaction checks, and verification tasks will surface here.',
    },
    {
      label: 'Deadlines',
      status: 'Planned',
      detail: 'Upcoming filing, hearing, and client response dates are not connected yet.',
    },
    {
      label: 'Matter activity',
      status: matterCount > 0 ? `${matterCount} active` : 'No live data',
      detail:
        matterCount > 0
          ? 'Open matter workspaces are available.'
          : 'Matter records are not populated in this workspace yet.',
    },
  ]
  const sourceItems = [
    { label: 'Legal source search', status: 'Live', detail: 'Search public sources and open stored judgments.' },
    { label: 'Case pages', status: 'Live', detail: 'Fetched judgments have stable internal pages.' },
    { label: 'Statutes and timelines', status: 'Planned', detail: 'Legislation and relationship timelines belong in this search surface next.' },
  ]

  function handleHomeSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = homeSearch.trim()
    if (!query) {
      void navigate({ to: '/search' })
      return
    }

    window.sessionStorage.setItem('obiter.search.initialQuery', query)
    void navigate({ to: '/search' })
  }

  return (
    <div className="shell-stack workspace-page">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Home</p>
          <h1 className="shell-header__title">Home</h1>
        </div>
        <button
          aria-label="Open product updates"
          className="workspace-changelog-button"
          type="button"
          onClick={() => setChangelogOpen(true)}
        >
          <Clock aria-hidden="true" />
        </button>
      </section>

      <form className="workspace-source-search" onSubmit={handleHomeSearch}>
        <label>
          <span>Search cases, statutes, issues</span>
          <input
            value={homeSearch}
            onChange={(event) => setHomeSearch(event.target.value)}
            placeholder="Potanina, limitation, Human Rights Act..."
            type="search"
          />
        </label>
        <button type="submit">Search</button>
      </form>

      <section className="workspace-dashboard" aria-label="Workspace dashboard">
        <article className="workspace-panel workspace-panel--attention">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-panel__eyebrow">Current status</p>
              <h2>Workspace signals</h2>
            </div>
            <span>{matterCount} matters</span>
          </div>
          <div className="workspace-list">
            {attentionItems.map((item) => (
              <div className="workspace-list__row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span>{item.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="workspace-panel workspace-panel--sources">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-panel__eyebrow">Legal sources</p>
              <h2>Search is live</h2>
            </div>
            <Link className="workspace-panel__link" to="/search">Open</Link>
          </div>
          <div className="workspace-list">
            {sourceItems.map((item) => (
              <div className="workspace-list__row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span>{item.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      {changelogOpen ? (
        <div className="workspace-updates-popover" role="dialog" aria-modal="false" aria-labelledby="workspace-changelog-title">
          <button
            aria-label="Close product updates"
            className="workspace-updates-popover__backdrop"
            type="button"
            onClick={() => setChangelogOpen(false)}
          />
          <section className="workspace-updates-popover__panel">
            <header className="workspace-updates-popover__header">
              <div>
                <p className="workspace-panel__eyebrow">Product updates</p>
                <h2 id="workspace-changelog-title">What changed recently</h2>
              </div>
              <button type="button" aria-label="Close product updates" onClick={() => setChangelogOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </header>
            {changelog.entries.length > 0 ? (
              <div className="workspace-list">
                {changelog.entries.slice(0, 8).map((entry) => (
                  <a className="workspace-list__row" href={entry.url} key={entry.url} rel="noreferrer" target="_blank">
                    <div>
                      <strong>{entry.title}</strong>
                      <p>{entry.date ?? 'Date unavailable'}</p>
                    </div>
                    <span>GitHub</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="workspace-panel__empty">GitHub updates are unavailable right now.</p>
            )}
            {activeMilestone && canSeeDevelopmentStatus(me) ? (
              <section className="workspace-dev-status">
                <p className="workspace-panel__eyebrow">Development status</p>
                <h3>{activeMilestone.label}</h3>
                <p>{activeMilestone.detail}</p>
              </section>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  )
}
