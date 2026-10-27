import { CheckCircle } from '@phosphor-icons/react'
import { ObiterMark, cn } from '@obiter/ui'
import type { FormEvent, ReactNode } from 'react'
import { ThemeToggle } from '../theme-toggle'

/**
 * The auth gate: the form on the left, a sample of the work on the right. It is
 * one layout for every signed-out screen so the entry point looks the same
 * whether a person is signing in, resetting a password or accepting an invite.
 *
 * Below 1025px the right-hand panel is dropped (as the mock-up does) and the
 * form sits in the middle of a single column, which is all a 1024px window has
 * room for.
 */
export function AuthLayout({
  footnote,
  children,
}: {
  /** The one line that closes the screen: what just happened, or what to know. */
  footnote: ReactNode
  children: ReactNode
}) {
  return (
    <main className="grid min-h-dvh bg-canvas text-ink compact:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)]">
      <div className="flex min-h-dvh flex-col px-6 pt-6 pb-8 compact:px-8">
        <header className="flex items-center justify-between gap-4">
          <span className="flex min-w-0 items-center gap-3">
            <ObiterMark className="size-6" title="" />
            <span className="text-item text-ink">Obiter</span>
          </span>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">{children}</div>
        </div>

        <p className="text-center text-caption text-subtle">{footnote}</p>
      </div>

      <AuthSamplePanel />
    </main>
  )
}

export function AuthHeading({
  title,
  description,
}: {
  title: ReactNode
  description: ReactNode
}) {
  return (
    <>
      <h1 className="text-page text-ink">{title}</h1>
      <p className="mt-2 max-w-[38ch] text-body text-muted">{description}</p>
    </>
  )
}

export function AuthForm({
  onSubmit,
  children,
  className,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
  className?: string
}) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={cn('mt-6 flex flex-col gap-4', className)}
    >
      {children}
    </form>
  )
}

/** The completed step replaces the form rather than sitting beside it. */
export function AuthDone({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-start gap-3 pt-2">
      <span className="grid size-10 place-items-center rounded-lg bg-success-soft text-success">
        <CheckCircle size={20} aria-hidden />
      </span>
      <h1 className="text-page text-ink">{title}</h1>
      {children}
    </div>
  )
}

/** The "new here / remembered it" line that closes the form block. */
export function AuthFoot({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-caption text-subtle">{children}</p>
}

/**
 * A real clause with a tracked change, set in serif on paper, beside the
 * judgment that governs how a court reads it. It is an illustration of the
 * product, not state: the sheet is hidden from assistive technology and the
 * panel is labelled so a screen reader knows what it is.
 */
function AuthSamplePanel() {
  return (
    <aside
      aria-label="About Obiter"
      className="hidden flex-col justify-between gap-8 border-l border-line bg-surface p-10 compact:flex"
    >
      <div className="my-auto">
        <p className="mb-3 text-caption text-subtle">
          Clause 4.2 · Northgate Foods v Brightwater Packaging
        </p>
        <div
          aria-hidden="true"
          className="mx-auto w-[348px] max-w-full rounded-sm bg-paper px-8 py-8 font-serif text-meta text-paper-ink shadow-md"
        >
          <p className="mb-3 font-sans text-caption text-paper-muted">
            Supply Agreement · 12 January 2025
          </p>
          <h2 className="mb-2 text-item">4. Volumes</h2>
          <p className="mb-2">
            4.1 The Supplier shall supply the Products in accordance with each
            Order.
          </p>
          <p className="mb-2">
            4.2 The Buyer shall order, and the Supplier shall supply, not less
            than{' '}
            <del className="bg-danger-soft text-danger line-through">
              60,000
            </del>{' '}
            <ins className="bg-success-soft text-success underline">45,000</ins>{' '}
            units of the Products in each calendar month during the Term.
          </p>
          <p className="mt-4 border-t border-paper-muted/25 pt-3 font-sans text-caption text-paper-muted">
            Changed by Brightwater (Legal) · 24 Oct 2026
          </p>
        </div>
      </div>

      <div className="max-w-[42ch]">
        <p className="mb-1 text-caption text-subtle">Summary of the judgment</p>
        <p className="font-serif text-body text-ink">
          Interpretation is a unitary exercise. The court reads the words used
          in the context of the contract as a whole, and gives more or less
          weight to that wider context depending on the quality of the drafting.
        </p>
        <p className="mt-3 text-caption text-subtle">
          <em className="font-serif">Wood v Capita Insurance Services Ltd</em>{' '}
          [2017] UKSC 24 at [10]–[12]
        </p>
      </div>

      <p className="text-caption text-subtle">Evidence-first legal work</p>
    </aside>
  )
}
