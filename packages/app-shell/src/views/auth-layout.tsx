import { ObiterMark, cn } from '@obiter/ui'
import { CheckCircle } from '@obiter/ui/icons'
import type { FormEvent, ReactNode } from 'react'
import { ThemeToggle } from '../theme-toggle'

export const PRIVACY_POLICY_URL = 'https://obiter.si/privacy'
export const TERMS_OF_SERVICE_URL = 'https://obiter.si/terms'

const AUTH_LEGAL_LINKS = [
  { label: 'Privacy policy', href: PRIVACY_POLICY_URL },
  { label: 'Terms of service', href: TERMS_OF_SERVICE_URL },
] as const

export const authCardClassName =
  'mt-6 rounded-xl border border-line bg-raised p-6 compact:p-8'

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
    <main className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center px-6 pt-6 compact:px-8">
        <span aria-hidden />
        <span className="flex items-center gap-2.5">
          <ObiterMark className="size-6" title="" />
          <span className="text-item text-ink">Obiter</span>
        </span>
        <span className="justify-self-end">
          <ThemeToggle />
        </span>
      </header>

      <div className="flex flex-1 justify-center px-4 pt-[clamp(2rem,10vh,6rem)] pb-10">
        <div className={cn('w-full max-w-[420px]', columnClassName)}>
          {children}
        </div>
      </div>

      <footer className="flex flex-col items-center gap-2 px-6 pb-6 text-center text-caption text-subtle">
        <p>{footnote}</p>
        <nav aria-label="Legal" className="flex items-center gap-3">
          {AUTH_LEGAL_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              {link.label}
            </a>
          ))}
          <span>© 2026 Obiter</span>
        </nav>
      </footer>
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
    <div className="text-center">
      <h1 className="text-page text-ink">{title}</h1>
      <p
        className={cn(
          'mx-auto mt-2 max-w-[38ch] text-body text-muted',
          descriptionClassName,
        )}
      >
        {description}
      </p>
    </div>
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
      className={cn(authCardClassName, 'flex flex-col gap-5', className)}
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
    <div
      className={cn(
        authCardClassName,
        'mt-0 flex flex-col items-center gap-3 text-center',
      )}
    >
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

export function AuthCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(authCardClassName, 'flex flex-col gap-4', className)}>
      {children}
    </div>
  )
}
