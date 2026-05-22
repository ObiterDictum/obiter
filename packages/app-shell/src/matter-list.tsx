import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Card, EmptyState, StatusPill } from '@ormont/ui'
import {
  createMatterMutationOptions,
  formatApiError,
  listMattersQueryOptions,
} from './api'
import { formatDateTime, labelFromToken } from './format'

export function ApiMattersRouteView() {
  const matters = useQuery(listMattersQueryOptions())
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const createMatter = useMutation(createMatterMutationOptions(queryClient))
  const [name, setName] = useState('')
  const [clientReference, setClientReference] = useState('')
  const [primaryJurisdiction, setPrimaryJurisdiction] = useState('england_and_wales')
  const [legalDomain, setLegalDomain] = useState('civil_litigation')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await createMatter.mutateAsync({
      name,
      clientReference,
      primaryJurisdiction,
      legalDomains: legalDomain ? [legalDomain] : [],
      secondaryJurisdictions: [],
    })
    setName('')
    setClientReference('')
    void navigate({ to: '/matters/$matterId', params: { matterId: result.matter.id } })
  }

  return (
    <div className="shell-stack">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Matters</p>
          <h1 className="shell-header__title">Matter workspace</h1>
        </div>
      </section>

      <Card eyebrow="Create matter" title="Open a new matter workspace">
        <form className="matter-form" onSubmit={handleSubmit}>
          <label className="matter-field">
            <span>Matter name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="matter-field">
            <span>Client reference</span>
            <input
              value={clientReference}
              onChange={(event) => setClientReference(event.target.value)}
            />
          </label>
          <label className="matter-field">
            <span>Primary jurisdiction</span>
            <input
              value={primaryJurisdiction}
              onChange={(event) => setPrimaryJurisdiction(event.target.value)}
              required
            />
          </label>
          <label className="matter-field">
            <span>Legal domain</span>
            <input value={legalDomain} onChange={(event) => setLegalDomain(event.target.value)} />
          </label>
          <button className="matter-button" disabled={createMatter.isPending} type="submit">
            {createMatter.isPending ? 'Creating matter...' : 'Create matter'}
          </button>
        </form>
        {createMatter.isError ? (
          <p className="matter-error" role="alert">
            {formatApiError(createMatter.error)} Check your sign-in session and try again.
          </p>
        ) : null}
      </Card>

      <Card eyebrow="Open matters" title="Organisation matters">
        {matters.isLoading ? (
          <p className="shell-copy">Loading matters from the API...</p>
        ) : null}
        {matters.isError ? (
          <p className="matter-error" role="alert">
            {formatApiError(matters.error)} Sign in again or check the API is running, then refresh.
          </p>
        ) : null}
        {matters.isSuccess && matters.data.matters.length === 0 ? (
          <EmptyState
            title="No matters yet"
            body="Create a matter to start adding document metadata records and immutable initial versions."
          />
        ) : null}
        {matters.isSuccess && matters.data.matters.length > 0 ? (
          <div className="matter-list">
            {matters.data.matters.map((matter) => (
              <Link
                className="matter-list__item"
                key={matter.id}
                params={{ matterId: matter.id }}
                to="/matters/$matterId"
              >
                <span>
                  <strong>{matter.name}</strong>
                  <small>
                    {matter.clientReference || 'No client reference'} ·{' '}
                    {labelFromToken(matter.primaryJurisdiction)}
                  </small>
                </span>
                <span>
                  <StatusPill tone={matter.status === 'active' ? 'sage' : 'amber'}>
                    {matter.status}
                  </StatusPill>
                  <small>{formatDateTime(matter.updatedAt)}</small>
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
