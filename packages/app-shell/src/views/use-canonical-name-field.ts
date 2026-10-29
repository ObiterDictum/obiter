import { useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api'

export interface CanonicalNameFieldOptions {
  identity: string
  canonical: string
  requiredMessage: string
  failureMessage: string
  save: (name: string) => Promise<string>
  focusField: () => void
}

export interface CanonicalNameField {
  value: string
  error: string | null
  saved: boolean
  submitting: boolean
  dirty: boolean
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
  const [seenCanonical, setSeenCanonical] = useState(canonical)
  const [draft, setDraft] = useState(canonical)
  const [baseline, setBaseline] = useState(canonical)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const sequence = useRef(0)
  const submittingRef = useRef(false)
  const canonicalRef = useRef(canonical)
  canonicalRef.current = canonical

  if (identity !== activeIdentity) {
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
        if (sequenceAtSubmit !== sequence.current) return
        const latest = canonicalRef.current
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
