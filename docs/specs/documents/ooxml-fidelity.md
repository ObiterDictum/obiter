# OOXML fidelity

Status: owner-approved and normative for the Stage B package core.

## Purpose

`@obiter/ooxml` provides a lossless-by-construction DOCX fidelity layer. It preserves the package and its semantic XML structure so later document features can make narrow edits without silently discarding Word content. It does not render documents, define editing semantics for tracked changes, integrate with routes or Redact, or handle PDF.

## Public package API

The package exports:

```ts
parseDocx(input: Uint8Array): Promise<OoxmlDocument>
serialiseDocx(document: OoxmlDocument): Promise<Uint8Array>
compareXmlSemantics(expectedXml: string, actualXml: string): SemanticEquivalenceResult
compareOoxmlPackages(
  expected: ComparableOoxmlPackage,
  actual: ComparableOoxmlPackage,
): SemanticEquivalenceResult
```

It also exports the logical model types needed to inspect and edit paragraphs, runs, styles, numbering and stories. `OoxmlDocument` combines that logical model with package-internal source parts, overlay nodes and dirty state. The shared JSON representation is `DocumentModelWire`, defined once in `@obiter/contracts`; source ZIP bytes and runtime dirty state never enter that wire shape.

The equivalence API implements [Semantic XML equivalence](semantic-xml-equivalence.md). It returns curated mismatch categories and never returns source XML or parser diagnostics.

## Lossless-by-construction contract

Parsing stores the original payload bytes for every non-directory ZIP entry and records whether each part is XML or binary. Parsing does not mark any part dirty. Unknown parts default to opaque preservation, never deletion.

### Typed overlays

Content-bearing and future-editable XML parts use source-preserving typed overlays. An overlay is an ordered node sequence in which:

- modelled nodes expose typed values;
- every node retains its original source fragment, unknown attributes, unknown children and original position;
- whitespace and interstitial fragments are nodes;
- a clean node replays its source fragment;
- a changed node is regenerated while clean siblings and preserved fragments are replayed.

The implementation must not parse and regenerate a complete XML part merely because one descendant changed.

### Opaque preservation

All XML outside the typed inventory is preserved as an opaque whole part until a later feature explicitly replaces it. Binary entries, including images and embeddings, are also opaque whole parts. `[Content_Types].xml`, every `.rels` part and every unknown part are retained and emitted. A relationship or content-types part may become dirty only through an explicit package operation.

### Dirty-state propagation

Dirty state is explicit on editable model nodes and their containing source part. A node edit marks only its containing XML part dirty. It does not dirty related stories, relationships, styles, numbering or package metadata unless an explicit package operation changes those parts. New parts can only arise from an explicit operation, never as a parsing side effect.

`serialiseDocx` emits every original part name. Clean parts use their original payload bytes. Dirty XML parts apply the smallest overlay patch that represents the intentional edit.

### Golden guarantee

A parse followed by serialisation with no model mutation leaves every source part payload byte-identical. After a mutation:

1. every untouched part payload remains byte-identical;
2. the touched XML part is semantically equivalent to the source under the project relation, except for the intentional edit;
3. the package has the same part set unless an explicit package operation added or removed a part.

ZIP entry order, directory entries, compression, timestamps and other ZIP layout details are not part payload semantics. Semantic equivalence is the floor for regenerated XML, not a relaxation of byte identity for clean parts.

## Tracked changes

S1 preserves these subtrees intact and in place:

- `w:ins`
- `w:del`
- `w:moveFrom`
- `w:moveTo`
- `w:pPrChange`
- `w:rPrChange`

They are opaque overlay subtrees in S1. Parsing does not descend into them as ordinary typed content. Their complete lexical form, child markup, position, unknown attributes, `w:author`, `w:date` and any other attributes survive round trips. Slice 5 may add typed editing semantics, but an unedited change must continue to replay its preserved subtree.

## Model identity

Paragraphs and text runs have stable model identity. Existing `w14:paraId` and `w14:textId` values are resolved by namespace URI and passed through when their node is regenerated. A literal `w14` prefix check is prohibited.

When either value is absent, a per-document deterministic encounter allocator supplies internal IDs such as `para-000001` and `text-000001`. Tests inject or reset the allocator. Internal IDs live in the model side map and may appear in `DocumentModelWire`, but are never emitted as new OOXML attributes and do not participate in XML equivalence. Path-derived identity is prohibited.

## Part inventory

### Typed, source-preserving content

| Part                 | Story or role                                                                             | Relationships retained                              |
| -------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `word/document.xml`  | Main document, including tables, fields, content controls and text boxes within the story | `word/_rels/document.xml.rels`                      |
| `word/header*.xml`   | Every header referenced by section properties                                             | Matching `word/_rels/header*.xml.rels` when present |
| `word/footer*.xml`   | Every footer referenced by section properties                                             | Matching `word/_rels/footer*.xml.rels` when present |
| `word/footnotes.xml` | Footnote separator, continuation and content stories                                      | `word/_rels/footnotes.xml.rels` when present        |
| `word/endnotes.xml`  | Endnote separator, continuation and content stories                                       | `word/_rels/endnotes.xml.rels` when present         |
| `word/comments.xml`  | Comment stories                                                                           | `word/_rels/comments.xml.rels` when present         |
| `word/styles.xml`    | Typed style definitions with preserved unknown content                                    | Matching relationships when present                 |
| `word/numbering.xml` | Typed abstract numbering, instances and restart data with preserved unknown content       | Matching relationships when present                 |

Story discovery follows namespace-resolved relationships, not filename assumptions alone. Root relationships, document relationships, per-story relationships and their targets are all retained. Content in headers, footers, notes or comments is not treated as absent merely because it is outside `word/document.xml`.

### Opaque whole parts

Opaque XML includes settings, theme, font table, web settings, core/custom/application properties, glossary and building-block data, custom XML, comments extensions, signature parts and any unrecognised XML. Package metadata and relationships are source-preserved even when a typed relationship view is available. Binary media, embedded packages, OLE objects, fonts, signatures and unknown binary entries are byte-preserved.

## Conformance corpus manifest

Stage B places a deterministic manifest and builder in `packages/ooxml/fixtures/`. Fixtures are synthetic or publicly sourced, use fixed fictional names, fixed identifiers and fixed bytes, and contain no client material or raw legal text. A checked-in producer DOCX requires a public provenance note naming its source and producer/version.

The manifest must cover:

- numbering, nested lists and list restarts;
- style inheritance and linked styles;
- section breaks with differing headers and footers;
- footnotes, endnotes and comments;
- cross-references and `STYLEREF`, `SEQ`, `TOC` and `REF` fields;
- merged cells and nested tables;
- content controls and embedded images;
- all six tracked-change elements, including author and timestamp values;
- identity fixtures with and without `w14:paraId` and `w14:textId`.

Golden tests use the exported equivalence checker, not a second normaliser. They assert the same part set, semantic equivalence for every XML part, exact bytes for every binary part, and the stronger untouched-part byte identity guarantee. A focused mutation test changes one body paragraph and pins byte identity for headers, footers, relationships, content types, styles, numbering, images and every other untouched entry.

## Error and data boundary

Malformed or unsupported input may fail with a curated package error. Source-preservation fields containing XML fragments required for lossless round trips are part of the shared wire model and may be persisted as document data. Parser diagnostics, provider error text, incidental source snippets and original ZIP payload bytes are not wire fields and must never be logged, returned as diagnostics, persisted in fixtures or included in durable state.

## Stage boundary

Stage A consisted only of these specifications and the equivalence checker with focused tests. The owner approved the specifications before Stage B added package archive handling, the wire schema, parser, overlays, serialiser, fixtures and golden round-trip tests. S1 performs no PDF work; PDF import-to-view belongs to S2b.
