import { Link } from '@tanstack/react-router'
import { Button, Input, Select, cn } from '@obiter/ui'
import { useState, type FormEvent } from 'react'
import {
  ORGANISATION_NAME_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '@obiter/contracts'
import { accessRequestFailure, useCreateAccessRequest } from '../access-request'
import {
  CATEGORY_OPTIONS,
  COUNTRY_OPTIONS,
  countryFromSelect,
  validateRequestAccess,
  type FieldErrors,
  type RequestAccessForm,
} from './request-access-form'
import {
  AuthDone,
  AuthFoot,
  AuthForm,
  AuthHeading,
  AuthLayout,
} from './auth-layout'

export function RequestAccessRouteView() {
  const createAccessRequest = useCreateAccessRequest()
  const [form, setForm] = useState<RequestAccessForm>({
    name: '',
    email: '',
    category: '',
    country: '',
    organisationName: '',
    setUpOrganisation: false,
    acceptedTerms: false,
    acceptedPrivacyNotice: false,
    detailsAreTrue: false,
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [sentTo, setSentTo] = useState('')

  function update<Key extends keyof RequestAccessForm>(
    key: Key,
    value: RequestAccessForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors({})
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validateRequestAccess(form)
    setErrors(result.errors)
    if (!result.input) return
    try {
      await createAccessRequest.mutateAsync(result.input)
      setSentTo(result.input.email)
    } catch (cause) {
      const failure = accessRequestFailure(cause)
      setErrors({ [failure.field]: failure.message })
    }
  }

  if (sentTo) {
    return (
      <AuthLayout footnote="Need help? Contact your firm administrator.">
        <AuthDone title="Check your inbox">
          <p className="max-w-[42ch] text-body text-muted">
            We have sent a confirmation link to{' '}
            <span className="text-ink">{sentTo}</span>. Open it to confirm your
            access.
          </p>
          <p className="text-caption text-subtle">
            Nothing yet? Check your spam folder, then start again with the
            address you use for work or study.
          </p>
          <Button variant="secondary" onClick={() => setSentTo('')}>
            Use a different address
          </Button>
        </AuthDone>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      footnote="Need help? Contact your firm administrator."
      columnClassName="max-w-[440px]"
    >
      <AuthHeading
        title="Request access"
        description="Obiter is available to legal professionals, law students and academic researchers in the UK. Use your work or university email and we will confirm your access, usually straight away."
        descriptionClassName="max-w-none"
      />

      <AuthForm onSubmit={handleSubmit}>
        <Input
          label="Name"
          type="text"
          autoComplete="name"
          required
          maxLength={USER_NAME_MAX_LENGTH}
          className="h-control-large"
          value={form.name}
          error={errors.name}
          onChange={(event) => update('name', event.target.value)}
        />
        <Input
          label="Work or university email"
          type="email"
          autoComplete="email"
          required
          className="h-control-large"
          value={form.email}
          error={errors.email}
          onChange={(event) => update('email', event.target.value)}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-meta text-ink">I am a…</legend>
          {CATEGORY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4',
                'transition-[border-color,background-color] duration-150',
                form.category === option.value
                  ? 'border-brand bg-brand-soft'
                  : 'border-line bg-raised hover:border-line-strong',
                errors.category && 'border-danger',
              )}
            >
              <input
                type="radio"
                name="category"
                value={option.value}
                checked={form.category === option.value}
                onChange={() => update('category', option.value)}
                className="mt-1 size-4 shrink-0 accent-brand"
              />
              <span className="flex flex-col gap-1">
                <span className="text-meta text-ink">{option.label}</span>
                <span className="text-caption text-muted">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
          {errors.category ? (
            <p role="alert" className="text-caption text-danger">
              {errors.category}
            </p>
          ) : null}
        </fieldset>

        <Select
          label="Country"
          ariaLabel="Country"
          options={COUNTRY_OPTIONS}
          value={form.country}
          placeholder="Select a country"
          invalid={Boolean(errors.country)}
          onValueChange={(next) => update('country', countryFromSelect(next))}
        />
        {errors.country ? (
          <p role="alert" className="-mt-2 text-caption text-danger">
            {errors.country}
          </p>
        ) : null}

        <Input
          label="Organisation name"
          type="text"
          autoComplete="organization"
          required
          maxLength={ORGANISATION_NAME_MAX_LENGTH}
          className="h-control-large"
          value={form.organisationName}
          error={errors.organisationName}
          helperText="Your firm, chambers, university or department."
          onChange={(event) => update('organisationName', event.target.value)}
        />

        <label className="flex items-start gap-3 rounded-lg border border-line bg-raised p-4">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-brand"
            checked={form.setUpOrganisation}
            onChange={(event) =>
              update('setUpOrganisation', event.target.checked)
            }
          />
          <span className="flex flex-col gap-1">
            <span className="text-meta text-ink">
              I am setting up this organisation
            </span>
            <span className="text-caption text-muted">
              You become its admin, and the domain of the email you verify with
              becomes its verified domain.
            </span>
          </span>
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-meta text-ink">Before you send</legend>
          <label className="flex items-start gap-3 text-meta text-ink">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-brand"
              checked={form.acceptedTerms}
              onChange={(event) =>
                update('acceptedTerms', event.target.checked)
              }
            />
            I accept the tester terms.
          </label>
          <label className="flex items-start gap-3 text-meta text-ink">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-brand"
              checked={form.acceptedPrivacyNotice}
              onChange={(event) =>
                update('acceptedPrivacyNotice', event.target.checked)
              }
            />
            I accept the privacy notice.
          </label>
          <label className="flex items-start gap-3 text-meta text-ink">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0 accent-brand"
              checked={form.detailsAreTrue}
              onChange={(event) =>
                update('detailsAreTrue', event.target.checked)
              }
            />
            The details I have given are true.
          </label>
          <p className="text-caption text-subtle">
            The tester terms and the privacy notice are not published yet. We
            will link both here before launch.
          </p>
          {errors.attestations ? (
            <p role="alert" className="text-caption text-danger">
              {errors.attestations}
            </p>
          ) : null}
        </fieldset>

        {errors.form ? (
          <p role="alert" className="text-meta text-danger">
            {errors.form}
          </p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          loading={createAccessRequest.isPending}
          className="mt-1 w-full"
        >
          Request access
        </Button>
      </AuthForm>

      <AuthFoot>
        Already have an account?{' '}
        <Link to="/sign-in" className="text-ink hover:text-brand">
          Sign in
        </Link>
      </AuthFoot>
    </AuthLayout>
  )
}
