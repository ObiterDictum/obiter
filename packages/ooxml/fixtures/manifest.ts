export const ooxmlFixtureManifest = [
  {
    name: 'full-fidelity-with-w14-ids',
    hasW14Ids: true,
    covers: [
      'numbering-and-list-restarts',
      'style-inheritance-and-linked-styles',
      'section-breaks-with-differing-headers-and-footers',
      'footnotes',
      'endnotes',
      'cross-references',
      'styleref-field',
      'seq-field',
      'toc-field',
      'ref-field',
      'merged-and-nested-tables',
      'comments',
      'content-controls',
      'embedded-images',
      'tracked-ins',
      'tracked-del',
      'tracked-move-from',
      'tracked-move-to',
      'tracked-paragraph-properties',
      'tracked-run-properties',
      'identity-with-w14-ids',
    ],
  },
  {
    name: 'full-fidelity-without-w14-ids',
    hasW14Ids: false,
    covers: ['identity-without-w14-ids'],
  },
  {
    name: 'multi-level-list',
    hasW14Ids: true,
    covers: ['nested-lists'],
  },
] as const

export type OoxmlFixtureName = (typeof ooxmlFixtureManifest)[number]['name']
