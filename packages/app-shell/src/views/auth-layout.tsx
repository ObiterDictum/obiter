import { CheckCircle } from '@phosphor-icons/react'
import { ObiterMark, cn } from '@obiter/ui'
import type { FormEvent, ReactNode } from 'react'
import { ThemeToggle } from '../theme-toggle'
import authArtDark from '../assets/auth/auth-art-dark.webp'
import authArtLight from '../assets/auth/auth-art-light.webp'

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
 * The right-hand panel is decoration: it carries the product's mood and nothing
 * a person has to read, so it is hidden from assistive technology (the region is
 * labelled) and from every window narrower than the 1025px breakpoint.
 *
 * The artwork is one engraving per theme (Midjourney, 29 Oct 2026), full-bleed
 * and cropped by the panel. Both leave the top of the panel empty, so the one
 * line of text sits there rather than over the busy lines below.
 */
const AUTH_ART = { light: authArtLight, dark: authArtDark }

function AuthSamplePanel() {
  return (
    <aside
      aria-label="About Obiter"
      className="relative hidden overflow-hidden border-l border-line bg-surface compact:block"
    >
      <img
        src={AUTH_ART.light}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover dark:hidden"
      />
      <img
        src={AUTH_ART.dark}
        alt=""
        loading="lazy"
        decoding="async"
        className="hidden size-full object-cover dark:block"
      />
      <p className="absolute inset-x-0 top-0 p-10 text-caption text-subtle">
        Evidence-first legal work
      </p>
    </aside>
  )
}
