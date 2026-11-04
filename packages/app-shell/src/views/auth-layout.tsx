import { ObiterMark, cn } from '@obiter/ui'
import { CheckCircle } from '@obiter/ui/icons'
import type { FormEvent, ReactNode } from 'react'
import { ThemeToggle } from '../theme-toggle'
import authArtDark from '../assets/auth/auth-art-dark.webp'
import authArtLight from '../assets/auth/auth-art-light.webp'

export function AuthLayout({
  footnote,
  columnClassName,
  children,
}: {
  footnote: ReactNode
  columnClassName?: string
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
          <div className={cn('w-full max-w-[360px]', columnClassName)}>
            {children}
          </div>
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
  descriptionClassName,
}: {
  title: ReactNode
  description: ReactNode
  descriptionClassName?: string
}) {
  return (
    <>
      <h1 className="text-page text-ink">{title}</h1>
      <p
        className={cn(
          'mt-2 max-w-[38ch] text-body text-muted',
          descriptionClassName,
        )}
      >
        {description}
      </p>
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

export function AuthFoot({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-caption text-subtle">{children}</p>
}

const AUTH_ART = { light: authArtLight, dark: authArtDark }

function AuthSamplePanel() {
  return (
    <aside
      aria-label="About Obiter"
      className="sticky top-0 hidden h-dvh self-start p-2 pl-0 compact:block"
    >
      <div className="relative size-full overflow-hidden rounded-xl border border-line bg-raised">
        <img
          src={AUTH_ART.light}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover dark:hidden"
        />
        <img
          src={AUTH_ART.dark}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 hidden size-full object-cover dark:block"
        />
        <p className="absolute inset-x-0 top-0 p-8 text-caption text-subtle">
          Evidence-first legal work
        </p>
      </div>
    </aside>
  )
}
