import type { LegalAuthority } from '@ormont/legal-schema'

export const sampleJudgments: LegalAuthority[] = [
  {
    id: 'uksc-2024-1',
    title: 'Potanina v Potanin',
    neutralCitation: '[2024] UKSC 1',
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2024-01-31',
    sourceType: 'judgment',
    sourceUrl: 'https://www.supremecourt.uk/cases/uksc-2024-001.html',
    paragraphs: [
      {
        id: 'uksc-2024-1-p1',
        documentId: 'uksc-2024-1',
        paragraphNumber: 1,
        text: 'The appeal concerns permission to bring a claim for financial relief after an overseas divorce.',
      },
      {
        id: 'uksc-2024-1-p2',
        documentId: 'uksc-2024-1',
        paragraphNumber: 2,
        text: 'The judgment addresses the statutory gateway and the exercise of discretion.',
      },
    ],
  },
  {
    id: 'uksc-2024-2',
    title: 'Paul v Royal Wolverhampton NHS Trust',
    neutralCitation: '[2024] UKSC 2',
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2024-01-11',
    sourceType: 'judgment',
    sourceUrl: 'https://www.supremecourt.uk/cases/uksc-2024-002.html',
    paragraphs: [
      {
        id: 'uksc-2024-2-p1',
        documentId: 'uksc-2024-2',
        paragraphNumber: 1,
        text: 'The appeals concern claims by secondary victims in clinical negligence cases.',
      },
      {
        id: 'uksc-2024-2-p2',
        documentId: 'uksc-2024-2',
        paragraphNumber: 2,
        text: 'The court considers the limits of liability for psychiatric injury.',
      },
    ],
  },
  {
    id: 'uksc-2024-3',
    title: 'Thaler v Comptroller-General of Patents, Designs and Trade Marks',
    neutralCitation: '[2023] UKSC 49',
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2023-12-20',
    sourceType: 'judgment',
    sourceUrl: 'https://www.supremecourt.uk/cases/uksc-2023-049.html',
    paragraphs: [
      {
        id: 'uksc-2024-3-p1',
        documentId: 'uksc-2024-3',
        paragraphNumber: 1,
        text: 'The appeal concerns whether an artificial intelligence system can be named as an inventor.',
      },
      {
        id: 'uksc-2024-3-p2',
        documentId: 'uksc-2024-3',
        paragraphNumber: 2,
        text: 'The judgment interprets the Patents Act 1977 and the requirements for inventorship.',
      },
    ],
  },
]
