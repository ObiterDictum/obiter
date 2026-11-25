# Legislation search and reading

An exact Act citation, including the title and year, opens the Act at
`/ln/<identity>`. The search result and preview show the chapter, extent,
enactment date, Act status, provision and withheld counts, and the first
four top-level Parts when held, with “Read the Act” as the primary action.
Exact provision citations still open the
individual provision and its amendment history.

The Act opens in document order with Parts, Chapters, cross-headings and
provisions, followed by schedules. Its contents navigator highlights the
reading position. Selecting an entry or following a link such as
`/ln/ukpga/2010/15#section-149` loads the target page and focuses the heading.
The navigator updates as the reader scrolls. On narrow panes the contents
can be collapsed.

`GET /api/search/legislation/<identity>` supplies provenance and lightweight
contents metadata. `GET /api/search/legislation/<identity>/text?offset=0&limit=24`
returns up to 50 ordered entries and a nullable `nextOffset`. Structural entries
refer to the matching contents headings. Provisions include wording and nested
paragraphs when held, plus links to the individual provision and the official
source. The reader requests 24 entries at a time and loads subsequent pages as they
approach the viewport. Deep links start on the target page, with a control
to load earlier wording.

Alternative versions of a provision, such as an extent-specific version for
Scotland, keep their statutory number. legislation.gov.uk's version suffixes
(`3n1`) stay in label paths, URLs and anchors so each version is addressable,
but never appear in a label or citation. Each version of a versioned provision
carries a `versionNote` naming its extent, for example "Version for Scotland".

The provision reader's withholding and repeal rules apply to the Act reader.
Withheld and repealed provisions retain their place and show the relevant notice
and official link. Their stored wording is excluded from the response.
The Act header shows the source, acquisition date when
recorded, and that a point-in-time date was not recorded.
