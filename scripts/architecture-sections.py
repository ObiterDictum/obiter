"""Canonical section order and navigation grouping for docs/architecture.html.

    python scripts/architecture-sections.py

Re-running is idempotent: it reorders the sections in the page to match
GROUPS below and rebuilds the sidebar from the same list, so document order
and navigation order cannot drift apart. Adding a section means adding its
id to GROUPS and its label to LABELS; the script asserts the two sets match
the page and refuses to write otherwise.

Originally written to fix two defects:

Two defects being fixed:

1. Deployment sat under "State", which is a category error: deployment is not
   state the system holds.
2. The nav order did not match the document order. Nav listed infra/fixtures at
   positions 15-16; the document had them at 20-21. The scroll-spy highlight
   therefore jumped backwards while scrolling.

Both are fixed from one canonical order below, so they cannot drift apart
again.
"""

import pathlib
import re

GROUPS = [
    ("Orientation", ["overview", "stack", "runtime", "graph"]),
    ("Workspaces", ["clients", "services", "packages", "scripts"]),
    ("Interfaces", ["http", "lifecycle", "auth"]),
    ("State", ["data", "storage", "fixtures", "config"]),
    ("Behaviour", ["search-flow", "redact-flow", "corpus"]),
    ("Delivery", ["testing", "ci", "infra"]),
    ("Working here", ["where", "rules", "agents", "divergences"]),
    ("Reference", ["glossary", "docs"]),
]

LABELS = {
    "overview": "Overview",
    "stack": "The stack",
    "runtime": "Runtime topology",
    "graph": "Dependency graph",
    "clients": "Clients",
    "services": "Services",
    "packages": "Packages",
    "scripts": "Tooling",
    "http": "HTTP surface",
    "lifecycle": "Request lifecycle",
    "auth": "Auth and scoping",
    "data": "Data model",
    "storage": "Object storage",
    "fixtures": "Fixtures and benchmarks",
    "config": "Configuration",
    "search-flow": "Search flow",
    "redact-flow": "Redaction flow",
    "corpus": "Synthetic corpus",
    "testing": "Testing",
    "ci": "CI and release",
    "infra": "Deployment",
    "where": "Where things go",
    "rules": "Boundary rules",
    "agents": "Agent workflow",
    "divergences": "Known divergences",
    "glossary": "Glossary",
    "docs": "Document index",
}

CANONICAL = [s for _, ids in GROUPS for s in ids]

page = pathlib.Path("docs/architecture.html")
h = page.read_text(encoding="utf-8")

# --- pull the sections out, verifying none nest
pattern = re.compile(r'[ \t]*<section id="([^"]+)">.*?</section>\n', re.S)
found = list(pattern.finditer(h))
ids = [m.group(1) for m in found]

assert len(ids) == len(set(ids)), "duplicate section ids"
assert set(ids) == set(CANONICAL), (
    "section set mismatch\n  only in page: %s\n  only in plan: %s"
    % (sorted(set(ids) - set(CANONICAL)), sorted(set(CANONICAL) - set(ids)))
)
for m in found:
    inner = m.group(0)[m.group(0).index(">") + 1 :]
    assert "<section" not in inner, "nested section in %s" % m.group(1)

blocks = {m.group(1): m.group(0) for m in found}

# --- rebuild the run of sections in canonical order
start, end = found[0].start(), found[-1].end()
between = h[found[0].end() : found[1].start()]
assert between.strip() == "", "unexpected content between sections: %r" % between[:80]

h = h[:start] + "".join(blocks[s] + "\n" for s in CANONICAL).rstrip("\n") + "\n" + h[end:]

# --- rebuild the nav from the same source of truth
nav_pattern = re.compile(r'(<ul class="toc">)(.*?)(</ul>)', re.S)
assert len(nav_pattern.findall(h)) == 1

lines = []
for group, section_ids in GROUPS:
    lines.append('          <li class="grp">%s</li>' % group)
    for sid in section_ids:
        lines.append(
            '          <li><a href="#%s">%s</a></li>' % (sid, LABELS[sid])
        )

h = nav_pattern.sub(
    lambda m: m.group(1) + "\n" + "\n".join(lines) + "\n        " + m.group(3), h, count=1
)

page.write_text(h, encoding="utf-8")
print("reordered %d sections into %d groups" % (len(CANONICAL), len(GROUPS)))
