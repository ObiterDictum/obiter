import type { ReactNode } from 'react'
import { ObiterMark, RatioMascot } from '@obiter/ui'
import {
  Eraser,
  Folders,
  Lock,
  MagnifyingGlass,
  Question,
  ShieldCheck,
} from '@obiter/ui/icons'
import { judgmentCoverage } from './components/search/search-coverage'
import { formatShortcut } from './keyboard-platform'

export interface WelcomeStep {
  id: string
  title: string
  art: ReactNode
  body: ReactNode
}

const iconProps = { size: 28, 'aria-hidden': true } as const

function Paragraphs({ items }: { items: ReactNode[] }) {
  return (
    <div className="flex flex-col gap-3 text-body text-muted">
      {items.map((item, at) => (
        <p key={at}>{item}</p>
      ))}
    </div>
  )
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-sans text-caption text-ink">
      {children}
    </kbd>
  )
}

export function welcomeSteps(isMac: boolean): WelcomeStep[] {
  const palette = formatShortcut(['primary', 'K'], isMac)
  return [
    {
      id: 'welcome',
      title: 'Welcome to Obiter',
      art: <ObiterMark title="" className="size-8" />,
      body: (
        <Paragraphs
          items={[
            'Obiter is a UK legal workspace. Each client matter keeps its documents together, and you can search the law, check citations and redact documents in the same place.',
          ]}
        />
      ),
    },
    {
      id: 'matters',
      title: 'Matters hold the work',
      art: <Folders {...iconProps} />,
      body: (
        <Paragraphs
          items={[
            'Choose New matter from Home or Matters to give your documents, checks and sources a workspace.',
            'Upload Word, PDF or text files to a matter, or create a new Word document.',
            <>
              To rename a document, open it and select its title, or press{' '}
              <Key>{formatShortcut(['F2'], isMac)}</Key>.
            </>,
          ]}
        />
      ),
    },
    {
      id: 'search',
      title: 'Search case law and legislation',
      art: <MagnifyingGlass {...iconProps} />,
      body: (
        <Paragraphs
          items={[
            'Search judgments and legislation together. Case law comes from The National Archives (Find Case Law) and legislation from legislation.gov.uk.',
            'Link to numbered judgment paragraphs and cite individual legislation provision pages.',
            judgmentCoverage,
          ]}
        />
      ),
    },
    {
      id: 'redact',
      title: 'Review and export redactions',
      art: <Eraser {...iconProps} />,
      body: (
        <div className="flex flex-col gap-3 text-body text-muted">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Detection marks candidate personal details.</li>
            <li>You review each span and choose Redact or Keep visible.</li>
            <li>You finalise, then download the redacted copy.</li>
          </ol>
          <p>
            Check for missed details before you finalise. Obiter keeps the
            original.
          </p>
        </div>
      ),
    },
    {
      id: 'verify',
      title: 'Verify citations and quotations',
      art: <ShieldCheck {...iconProps} />,
      body: (
        <Paragraphs
          items={[
            'Verify reads the citations and quotations in a document and checks them against the sources Obiter stores.',
            'It works on Word, PDF and text files. Scanned PDFs need OCR, which Obiter does not do yet.',
            'Review any findings Verify could not confirm.',
          ]}
        />
      ),
    },
    {
      id: 'ratio',
      title: 'Ratio, the agent',
      art: <RatioMascot state="idle" size={44} label="Ratio" live={false} />,
      body: (
        <Paragraphs
          items={[
            'Ratio is Obiter’s agent. Open the Agent panel in a matter to use it alongside your work.',
            'Ratio needs a model before it can answer. An owner or admin of your organisation connects one in Settings → Agent.',
          ]}
        />
      ),
    },
    {
      id: 'data',
      title: 'Your data',
      art: <Lock {...iconProps} />,
      body: (
        <Paragraphs
          items={[
            'Matter data stays in your organisation’s workspace, where access is controlled by matter permissions.',
            'Ratio sends your prompt to your organisation’s model provider. It can retrieve matter document text for the model only if an owner or admin enables Send matter documents to the model provider in Settings → Agent. The setting is off by default.',
            'Obiter runs redaction detection within its own service.',
          ]}
        />
      ),
    },
    {
      id: 'help',
      title: 'Help and feedback',
      art: <Question {...iconProps} />,
      body: (
        <Paragraphs
          items={[
            'Send feedback from the account menu, the round button with your initials.',
            <>
              Press <Key>{palette}</Key> to open the command palette and jump to
              matters, documents and actions.
            </>,
            'Reopen from Welcome guide in the account menu, or choose Show welcome guide in the command palette or Settings → Preferences.',
            'Home shows a Getting started checklist until you finish or hide it.',
          ]}
        />
      ),
    },
  ]
}
