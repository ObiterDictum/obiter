import { useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api'

/**
 * One form-state policy for the Settings name fields.
 *
 * The field text, the saved baseline and the mutation results are reconciled in
 * one place so that:
 *
 * - a save never discards text typed while the request was in flight;
 * - the baseline always tracks the authoritative value, so Reset returns to the
 *   latest stored value rather than the value from the first mount;
 * - a refetched or cross-tab canonical value advances a clean field and is
 *   preserved as the baseline when the field is dirty;
 * - a stale mutation response cannot regress a value that arrived after the
 *   request began;
 * - a failure keeps both the draft and the previous baseline;
 * - switching identity (account or organisation) discards all of it.
 *
 * The `canonical` value is the query cache's, not the input's: the form shows
 * what the server kept. Reconciliation happens during render against the stored
 * previous prop, which is React's supported alternative to an unconditional
 * prop-to-state effect — an effect would paint the stale value first and lose
 * whatever the user typed in between.
 */
export interface CanonicalNameFieldOptions {
  /** Identity of the record being edited; a change discards all field state. */
  identity: string
  /** The authoritative value from the query cache. */
  canonical: string
  /** Message shown when the field is submitted blank. */
  requiredMessage: string
  /** Fallback message for a failure that is not an `ApiError`. */
  failureMessage: string
  /** Runs the mutation and resolves with the canonical value the server kept. */
  save: (name: string) => Promise<string>
  /** Called when the field needs focus after a rejected submission. */
  focusField: () => void
}

export interface CanonicalNameField {
  value: string
  error: string | null
  saved: boolean
  submitting: boolean
  dirty: boolean
  /** Set when a dirty field has been emptied; explains the disabled Save. */
  blankError: string | null
  canSave: boolean
  setValue: (next: string) => void
  submit: (event?: FormEvent<HTMLFormElement>) => void
  reset: () => void
}

export function useCanonicalNameField({
  identity,
  canonical,
  requiredMessage,
  failureMessage,
  save,
  focusField,
}: CanonicalNameFieldOptions): CanonicalNameField {
  const [activeIdentity, setActiveIdentity] = useState(identity)
  // The last `canonical` prop seen, not a mirror of local state: comparing the
  // prop against itself is what distinguishes a real external change from a
  // save whose result the query cache has not published yet.
  const [seenCanonical, setSeenCanonical] = useState(canonical)
  const [draft, setDraft] = useState(canonical)
  const [baseline, setBaseline] = useState(canonical)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Invalidates the response of a submission that is no longer the current one.
  const sequence = useRef(0)
  const submittingRef = useRef(false)
  // The latest authoritative value in the render that is on screen, read when a
  // promise resolves so a response cannot regress a value that landed after the
  // request was sent.
  const canonicalRef = useRef(canonical)
  canonicalRef.current = canonical

  if (identity !== activeIdentity) {
    // Another record owns this control now: no draft, notice, error or baseline
    // may carry across, and any response still in flight is discarded.
    sequence.current += 1
    submittingRef.current = false
    setActiveIdentity(identity)
    setSeenCanonical(canonical)
    setDraft(canonical)
    setBaseline(canonical)
    setError(null)
    setSaved(false)
    setSubmitting(false)
  } else if (canonical !== seenCanonical) {
    // A refetch or another writer produced a new authoritative value. The
    // baseline always advances; the field follows only when it still holds the
    // previous baseline, i.e. the user has typed nothing since it last saved.
    const previousBaseline = baseline
    setSeenCanonical(canonical)
    setBaseline(canonical)
    setDraft((current) => (current === previousBaseline ? canonical : current))
  }

  const trimmed = draft.trim()
  const dirty = trimmed !== baseline
  const blankError = dirty && trimmed.length === 0 ? requiredMessage : null
  const canSave = dirty && trimmed.length > 0 && !submitting

  function updateValue(next: string) {
    setDraft(next)
    setSaved(false)
    setError(null)
  }

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (submittingRef.current || !dirty) return
    const submittedDraft = draft
    const name = submittedDraft.trim()
    setError(null)
    setSaved(false)
    if (name.length === 0) {
      setError(requiredMessage)
      focusField()
      return
    }

    const sequenceAtSubmit = ++sequence.current
    const canonicalAtSubmit = canonicalRef.current
    submittingRef.current = true
    setSubmitting(true)
    void (async () => {
      try {
        const stored = await save(name)
        // A newer submission has taken over; this response is stale.
        if (sequenceAtSubmit !== sequence.current) return
        const latest = canonicalRef.current
        // A different authoritative value arrived while this request was in
        // flight. It is newer than this response, so it wins; adopting the
        // stored value here would regress a later cache value.
        const authoritative =
          latest !== stored && latest !== canonicalAtSubmit ? latest : stored
        setBaseline(authoritative)
        setDraft((current) =>
          current === submittedDraft ? authoritative : current,
        )
        setSaved(true)
      } catch (cause) {
        if (sequenceAtSubmit !== sequence.current) return
        setError(cause instanceof ApiError ? cause.message : failureMessage)
        focusField()
      } finally {
        if (sequenceAtSubmit === sequence.current) {
          submittingRef.current = false
          setSubmitting(false)
        }
      }
    })()
  }

  function reset() {
    setDraft(baseline)
    setError(null)
    setSaved(false)
    focusField()
  }

  return {
    value: draft,
    error,
    saved,
    submitting,
    dirty,
    blankError,
    canSave,
    setValue: updateValue,
    submit,
    reset,
  }
}
