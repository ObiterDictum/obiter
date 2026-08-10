# Semantic XML equivalence

Status: normative for `@obiter/ooxml` fidelity and its correctness tests.

This document defines the project's meaning of faithful OOXML XML. The exported checker in `packages/ooxml/src/equivalence.ts` implements this relation. Golden tests must call that checker rather than maintain a second test normaliser.

## Package relation

Two OOXML packages are semantically equivalent when all of the following hold:

1. They contain exactly the same set of non-directory part names.
2. Every XML part is equivalent under the XML relation below. This includes `[Content_Types].xml` and every relationships part.
3. Every binary part has exactly the same payload bytes. S1 defines no weaker binary relation.

ZIP entry order, directory entries, compression method, compression level, ZIP timestamps and other ZIP layout details are excluded.

## XML relation

An XML part is converted to a namespace-resolved node sequence. Two XML parts are equivalent when those sequences are equal under all of these rules.

### Elements

Element identity is the pair of namespace URI and local name. Prefix spelling and namespace bindings are not compared directly after names have been resolved. Element order, nesting and sibling order are significant.

A dropped or added element, changed namespace URI, changed local name, changed nesting, or reordered sibling makes the parts non-equivalent.

### Attributes

Attributes are an unordered set. Each attribute is identified by its namespace URI and local name and has an exact string value.

Attribute order is ignored. Namespace declaration attributes are namespace mechanics and are excluded after namespace resolution. The default namespace applies to element names, not to unprefixed attribute names.

A dropped or added attribute, changed namespace URI, changed local name, or changed value makes the parts non-equivalent.

### Character data

XML 1.0 line-end normalisation applies before comparison, so CRLF and lone CR line endings become LF. Character data is then compared exactly, including spaces, tabs, line breaks and every empty text node exposed by the parser. No trimming, pretty-print normalisation, Unicode normalisation, whitespace collapsing or further line-boundary rewriting is allowed. Adjacent character-data nodes may be coalesced before comparison.

Predefined entity references and decimal or hexadecimal character references are compared by their decoded character data. CDATA and escaped text with the same character data are equivalent.

Changed text or whitespace makes the parts non-equivalent.

### Comments and processing instructions

Comments are nodes in the sequence and are compared in order by exact text.

Processing instructions are nodes in the sequence and are compared in order by exact target and data. The XML declaration is not a processing instruction for this relation and is excluded.

Adding, dropping, moving or changing a comment or processing instruction makes the parts non-equivalent.

### Equivalent lexical forms

The following lexical differences do not affect equivalence:

- namespace prefix spelling;
- namespace declaration placement where resolved names are unchanged;
- attribute order;
- XML declaration presence, encoding declaration, version, quote style or other declaration spelling;
- element and attribute quote style;
- self-closing versus explicit empty-element form;
- predefined entity or character-reference spelling after one XML decoding pass;
- CDATA versus escaped text with the same character data.

The checker does not compare raw XML bytes, source fragment boundaries or serializer formatting for a dirty part.

## Unsupported XML and fail-closed behaviour

External DTDs and custom entity expansion are unsupported. The checker rejects an XML input containing an external `SYSTEM` or `PUBLIC` DTD identifier or an entity declaration. It does not resolve files, URLs or provider-defined entities. A malformed document, an unbound namespace prefix or unsupported parser output also fails closed and is not equivalent, including when both inputs fail in the same way.

Failure results contain only a curated category and optional part name. They do not contain source XML or raw parser diagnostics.

## Byte identity and semantic equivalence

Semantic equivalence is the minimum relation for XML that was intentionally regenerated. It is not the preservation rule for untouched content.

- A clean part must retain byte-identical payload bytes. Semantic equivalence alone is insufficient.
- A dirty XML part must be semantically equivalent to its source after accounting for the single intentional edit.
- Every untouched part remains byte-identical after another part is edited.
- A binary part is always compared by exact payload bytes in S1.

Therefore a no-op parse and serialise round trip is tested with per-part byte identity. A mutation round trip uses semantic equivalence only for the touched XML part and byte identity for every untouched part.

## Required checker examples

The checker tests pin both directions of the relation:

| Change                                                               | Result                         |
| -------------------------------------------------------------------- | ------------------------------ |
| Prefix rename with the same namespace URI                            | Equivalent                     |
| Attribute reorder                                                    | Equivalent                     |
| `&amp;`, a character reference or CDATA yielding the same characters | Equivalent                     |
| `<w:p/>` versus `<w:p></w:p>`                                        | Equivalent                     |
| Different ZIP order or timestamp                                     | Excluded at package-part level |
| Dropped element                                                      | Not equivalent                 |
| Changed namespace URI                                                | Not equivalent                 |
| Changed attribute value                                              | Not equivalent                 |
| Changed character data or whitespace                                 | Not equivalent                 |
| Reordered siblings                                                   | Not equivalent                 |
| Changed, moved or dropped comment                                    | Not equivalent                 |
| Changed, moved or dropped processing instruction                     | Not equivalent                 |
| External DTD or custom entity declaration                            | Fail closed, not equivalent    |
