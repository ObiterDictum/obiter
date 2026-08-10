"""Regenerate the SVG diagrams embedded in docs/architecture.html.

    python scripts/architecture-diagrams.py            # write diagrams.json
    python scripts/architecture-diagrams.py --apply    # rewrite the html too

Layout is computed rather than hand-placed so edge endpoints land on node
borders and nothing overlaps. Colours reference the page's CSS custom
properties, so the diagrams follow the light/dark theme with no second palette.

Editing a diagram means editing the node/edge declarations near the bottom of
this file and re-running it. Do not hand-patch the SVG in the HTML: the
geometry checks below will not have run on it.
"""

from html import escape

CH = 6.05  # approx advance width of JetBrains Mono at 10px
PAD_X = 11
NODE_H = 30
SUB_H = 11


def node_width(label, sub=None):
    w = len(label) * CH + PAD_X * 2
    if sub:
        w = max(w, len(sub) * 5.3 + PAD_X * 2)
    return round(max(w, 74), 1)


class Diagram:
    def __init__(self, width, height, title, desc):
        self.w, self.h = width, height
        self.title, self.desc = title, desc
        self.nodes = {}
        self.parts = []

    def node(self, key, x, y, label, sub=None, accent="var(--line-strong)",
             kind="solid", h=None):
        h = h or (NODE_H + (SUB_H if sub else 0))
        w = node_width(label, sub)
        self.nodes[key] = dict(x=x, y=y, w=w, h=h, cx=x + w / 2, cy=y + h / 2)
        dash = ' stroke-dasharray="3 3"' if kind == "dashed" else ""
        fill = "var(--raised)" if kind != "ghost" else "none"
        self.parts.append(
            f'<g><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" '
            f'fill="{fill}" stroke="{accent}"{dash}/>'
            f'<text x="{x + w / 2}" y="{y + (17 if sub else h / 2 + 3.5)}" '
            f'text-anchor="middle" class="n">{escape(label)}</text>'
            + (f'<text x="{x + w / 2}" y="{y + 28}" text-anchor="middle" '
               f'class="s">{escape(sub)}</text>' if sub else "")
            + "</g>"
        )

    def _anchor(self, n, side):
        return {
            "t": (n["cx"], n["y"]),
            "b": (n["cx"], n["y"] + n["h"]),
            "l": (n["x"], n["cy"]),
            "r": (n["x"] + n["w"], n["cy"]),
        }[side]

    def edge(self, a, b, sa="b", sb="t", label=None, tone="var(--line-strong)",
             dashed=False, curve=0, lx=0, ly=0):
        x1, y1 = self._anchor(self.nodes[a], sa)
        x2, y2 = self._anchor(self.nodes[b], sb)
        if curve:
            mx, my = (x1 + x2) / 2 + curve, (y1 + y2) / 2
            d = f"M{x1},{y1} Q{mx},{my} {x2},{y2}"
        else:
            d = f"M{x1},{y1} L{x2},{y2}"
        dash = ' stroke-dasharray="4 3"' if dashed else ""
        # Arrowheads match their line colour; a neutral head on a danger edge
        # reads as a rendering bug.
        head = self.mid("ahd" if "danger" in tone else "ah")
        self.parts.append(
            f'<path d="{d}" fill="none" stroke="{tone}" stroke-width="1"'
            f'{dash} marker-end="url(#{head})"/>'
        )
        if label:
            self.parts.append(
                f'<text x="{(x1 + x2) / 2 + lx}" y="{(y1 + y2) / 2 + ly}" '
                f'text-anchor="middle" class="e">{escape(label)}</text>'
            )

    def band(self, x, y, w, h, label, accent):
        self.parts.insert(0,
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" '
            f'fill="var(--surface)" stroke="var(--line)"/>'
            f'<text x="{x + 9}" y="{y + 15}" class="b" fill="{accent}">'
            f'{escape(label)}</text>')

    def render(self):
        return (
            f'<svg viewBox="0 0 {self.w} {self.h}" role="img" '
            f'aria-labelledby="{self.title_id()}" xmlns="http://www.w3.org/2000/svg">'
            f'<title id="{self.title_id()}">{escape(self.title)}</title>'
            f"<desc>{escape(self.desc)}</desc>"
            "<defs>"
            f'<marker id="{self.mid("ah")}" viewBox="0 0 8 8" refX="7" refY="4" '
            'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            '<path d="M0,1 L7,4 L0,7 z" fill="var(--line-strong)"/></marker>'
            f'<marker id="{self.mid("ahd")}" viewBox="0 0 8 8" refX="7" refY="4" '
            'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
            '<path d="M0,1 L7,4 L0,7 z" fill="var(--danger)"/></marker>'
            "</defs>"
            + "".join(self.parts)
            + "</svg>"
        )

    def title_id(self):
        return "t-" + self.title.lower().replace(" ", "-")

    def mid(self, name):
        """Marker ids must be unique: all four diagrams inline into one page."""
        return f"{name}-{self.title_id()}"


# ---------------------------------------------------------------- build-time
d1 = Diagram(920, 430, "Build-time dependency graph",
             "Workspace packages arranged by dependency depth, with arrows "
             "pointing from a dependent to what it depends on.")
d1.band(8, 8, 904, 62, "CONSUMERS", "var(--info)")
d1.band(8, 108, 904, 62, "FEATURE UI", "var(--warning)")
d1.band(8, 208, 904, 62, "DOMAIN", "var(--warning)")
d1.band(8, 308, 904, 62, "PRIMITIVES", "var(--subtle)")

d1.node("web", 40, 26, "@obiter/web", accent="var(--info)")
d1.node("desktop", 200, 26, "@obiter/desktop", accent="var(--info)")
d1.node("api", 420, 26, "@obiter/api", accent="var(--brand)")
d1.node("ingestor", 610, 26, "@obiter/legal-ingestor", accent="var(--brand)")

d1.node("shell", 60, 126, "@obiter/app-shell", accent="var(--warning)")
d1.node("redactui", 250, 126, "@obiter/redact-ui", accent="var(--warning)")

d1.node("ooxml", 60, 226, "@obiter/ooxml", accent="var(--warning)")
d1.node("policy", 330, 226, "@obiter/redaction-policy", accent="var(--warning)")
d1.node("searchc", 560, 226, "@obiter/search-client", accent="var(--warning)")
d1.node("rampart", 728, 226, "@obiter/rampart-inference", accent="var(--warning)")

d1.node("contracts", 60, 326, "@obiter/contracts", accent="var(--subtle)")
d1.node("ui", 250, 326, "@obiter/ui", accent="var(--subtle)")
d1.node("legalschema", 420, 326, "@obiter/legal-schema", accent="var(--subtle)")
d1.node("database", 640, 326, "@obiter/database", accent="var(--subtle)")

for a, b in [("web", "shell"), ("desktop", "shell"), ("web", "redactui"),
             ("desktop", "redactui")]:
    d1.edge(a, b)
d1.edge("redactui", "shell", sa="l", sb="r")
d1.edge("shell", "contracts")
d1.edge("shell", "ui", curve=30)
d1.edge("redactui", "policy")
d1.edge("redactui", "ui", curve=-20)
d1.edge("ooxml", "contracts")
d1.edge("policy", "contracts", curve=-60)
d1.edge("searchc", "legalschema", curve=-30)
d1.edge("api", "policy", curve=-30)
d1.edge("api", "searchc", curve=20)
d1.edge("api", "rampart", curve=60)
d1.edge("ingestor", "searchc", curve=-20)

# ------------------------------------------------------------------- runtime
d2 = Diagram(920, 400, "Runtime topology",
             "What talks to what at run time, distinct from build-time "
             "dependencies. Every store is self-hosted.")
d2.node("browser", 40, 40, "apps/web", "browser", accent="var(--info)")
d2.node("electron", 40, 130, "apps/desktop", "Electron", accent="var(--info)")
d2.node("api", 330, 84, "services/api", "Hono", accent="var(--brand)", h=46)
d2.node("ingestor", 330, 300, "services/legal-ingestor", accent="var(--brand)")

d2.node("pg", 660, 20, "PostgreSQL", "system of record", accent="var(--success)")
d2.node("meili", 660, 100, "Meilisearch", "derived index", accent="var(--success)")
d2.node("store", 660, 180, "Object storage", "filesystem", accent="var(--success)")
d2.node("fcl", 660, 260, "Find Case Law", "TNA", accent="var(--danger)")
d2.node("resend", 660, 340, "Resend", "email", accent="var(--danger)")
d2.node("model", 330, 200, "Rampart ONNX", "in-process", accent="var(--warning)")

d2.edge("browser", "api", sa="r", sb="l", label="cookie session", ly=-6)
d2.edge("electron", "api", sa="r", sb="l", label="bearer token", ly=12)
d2.edge("api", "pg", sa="r", sb="l", label="SQL", ly=-6)
d2.edge("api", "meili", sa="r", sb="l", label="search", ly=-6)
d2.edge("api", "store", sa="r", sb="l", label="objects", ly=10)
d2.edge("api", "fcl", sa="r", sb="l", label="hydrate", tone="var(--danger)",
        dashed=True, ly=14)
d2.edge("api", "resend", sa="r", sb="l", tone="var(--danger)", dashed=True)
d2.edge("api", "model", sa="b", sb="t", label="load", lx=26)
d2.edge("ingestor", "meili", sa="r", sb="b", label="index", ly=20)
d2.edge("ingestor", "fcl", sa="r", sb="b", tone="var(--danger)", dashed=True)

# -------------------------------------------------------------- search flow
d3 = Diagram(920, 300, "Search request flow",
             "Path of a query through exact lookup, lexical search and "
             "ranking, with the provider fallback that is due for removal.")
d3.node("q", 20, 120, "query", accent="var(--info)")
d3.node("classify", 130, 120, "classify")
d3.node("exact", 258, 120, "exact lookup", "id · citation")
d3.node("meili", 420, 120, "Meilisearch", "lexical")
d3.node("rank", 570, 120, "JS re-rank", "bucket score", accent="var(--danger)")
d3.node("snip", 715, 120, "snippets", "evidence ids")
d3.node("resp", 845, 120, "response", accent="var(--info)")
d3.node("pg", 420, 220, "Postgres tsvector", "second tier", accent="var(--danger)",
        kind="dashed")
d3.node("fcl", 420, 24, "Find Case Law", "on miss", accent="var(--danger)",
        kind="dashed")

d3.edge("q", "classify", sa="r", sb="l")
d3.edge("classify", "exact", sa="r", sb="l")
d3.edge("exact", "meili", sa="r", sb="l")
d3.edge("meili", "rank", sa="r", sb="l")
d3.edge("rank", "snip", sa="r", sb="l")
d3.edge("snip", "resp", sa="r", sb="l")
d3.edge("meili", "fcl", sa="t", sb="b", tone="var(--danger)", dashed=True,
        label="miss", lx=34)
d3.edge("meili", "pg", sa="b", sb="t", tone="var(--danger)", dashed=True,
        label="fallback", lx=42)

# ------------------------------------------------------------- redact flow
d4 = Diagram(920, 330, "Redaction pipeline",
             "Detection masks heuristic spans before the model runs, then "
             "projects offsets back. The degraded path skips the model.")
d4.node("in", 20, 130, "text in", "paste · DOCX · PDF", accent="var(--info)")
d4.node("heur", 165, 130, "heuristics", "deterministic")
d4.node("mask", 300, 130, "premask", "hide matches")
d4.node("ner", 425, 130, "Rampart NER", "on masked text", accent="var(--warning)")
d4.node("project", 570, 130, "project back", "to real offsets")
d4.node("merge", 710, 130, "merge", "model wins")
d4.node("review", 710, 230, "review", "reviewer decides")
d4.node("final", 500, 230, "finalize", "integrity check")
d4.node("out", 300, 230, "artifact", "+ audit report", accent="var(--success)")
d4.node("degraded", 425, 30, "model unavailable", "heuristics only",
        accent="var(--danger)", kind="dashed")

d4.edge("in", "heur", sa="r", sb="l")
d4.edge("heur", "mask", sa="r", sb="l")
d4.edge("mask", "ner", sa="r", sb="l")
d4.edge("ner", "project", sa="r", sb="l")
d4.edge("project", "merge", sa="r", sb="l")
d4.edge("merge", "review", sa="b", sb="t")
d4.edge("review", "final", sa="l", sb="r")
d4.edge("final", "out", sa="l", sb="r")
d4.edge("mask", "degraded", sa="t", sb="l", tone="var(--danger)", dashed=True)
d4.edge("degraded", "merge", sa="r", sb="t", tone="var(--danger)", dashed=True,
        label="unflagged", lx=40, ly=-6)

# ---------------------------------------------------------------------- ERD
d5 = Diagram(920, 430, "Entity relationships",
             "Tenant tables and their foreign keys. Composite keys carry the "
             "full ancestry, so the database rejects a cross-organisation "
             "reference rather than trusting the query.")
d5.parts.insert(0,
    '<rect x="14" y="52" width="640" height="360" rx="4" fill="var(--surface)" '
    'stroke="var(--brand)" stroke-dasharray="5 4"/>'
    '<text x="26" y="72" class="b" fill="var(--brand)">ORGANISATION SCOPE</text>')

d5.node("orgs", 250, 92, "organisations", "tenant root", accent="var(--brand)")
d5.node("users", 60, 92, "users", "+ sessions, accounts", accent="var(--subtle)")
d5.node("audit", 460, 92, "audit_logs", "org nullable", accent="var(--subtle)")
d5.node("matters", 60, 190, "matters", "soft-deletable")
d5.node("docs", 60, 280, "matter_documents")
d5.node("versions", 60, 360, "document_versions", "immutable")
d5.node("runs", 420, 280, "redaction_runs", "spans, decisions")
d5.node("artifacts", 420, 190, "artifacts", "generated output")
d5.node("legal", 700, 300, "legal_source_documents", "public corpus",
        accent="var(--info)")

d5.edge("matters", "orgs", sa="t", sb="l", label="organisation_id", lx=-30, ly=-4)
d5.edge("docs", "matters", sa="t", sb="b", label="id, organisation_id", lx=78)
d5.edge("versions", "docs", sa="t", sb="b", label="+ matter_id", lx=54)
d5.edge("runs", "versions", sa="l", sb="r", label="4-part composite", ly=-6)
d5.edge("runs", "artifacts", sa="t", sb="b", label="output", lx=32)
d5.edge("artifacts", "orgs", sa="t", sb="r", label="organisation_id", lx=26, ly=-4)
d5.edge("users", "orgs", sa="r", sb="l")

d5.parts.append(
    '<text x="700" y="368" class="e" fill="var(--info)">outside the boundary:</text>'
    '<text x="700" y="380" class="e" fill="var(--info)">no organisation_id</text>')

# ------------------------------------------------------- synthetic-v2 corpus
d6 = Diagram(920, 400, "Synthetic corpus pipeline",
             "Gates from provider connectivity through to a canonical "
             "tournament dataset. Each gate refuses to spend without evidence "
             "the previous one passed.")
d6.band(8, 8, 904, 96, "QUALIFICATION", "var(--warning)")
d6.band(8, 130, 904, 96, "PAID EXECUTION", "var(--danger)")
d6.band(8, 252, 904, 96, "ASSEMBLY", "var(--success)")

d6.node("smoke", 40, 42, "smoke", "connectivity only", accent="var(--warning)")
d6.node("canary", 220, 42, "canary", "full first spec", accent="var(--warning)")
d6.node("receipt", 420, 42, "receipt", "hash-bound", accent="var(--warning)")
d6.node("pricing", 640, 42, "spend cap", "per candidate GBP", accent="var(--warning)")

d6.node("cand", 40, 164, "candidate run", "one at a time", accent="var(--danger)")
d6.node("judges", 250, 164, "two judges", "primary + adjudicator",
        accent="var(--danger)")
d6.node("human", 470, 164, "human adjudication", "on disagreement",
        accent="var(--danger)")
d6.node("ledger", 700, 164, "spend ledger", "shared, sequential",
        accent="var(--danger)")

d6.node("registry", 40, 286, "run registry", "names + hashes",
        accent="var(--success)")
d6.node("assemble", 250, 286, "assemble", "no provider calls",
        accent="var(--success)")
d6.node("dataset", 450, 286, "tournament dataset", "canonical",
        accent="var(--success)")
d6.node("private", 680, 286, "private corpus repo", "never this repo",
        accent="var(--info)", kind="dashed")

d6.edge("smoke", "canary", sa="r", sb="l")
d6.edge("canary", "receipt", sa="r", sb="l")
d6.edge("receipt", "pricing", sa="r", sb="l")
d6.edge("receipt", "cand", sa="b", sb="t", label="gates", lx=-96)
d6.edge("cand", "judges", sa="r", sb="l")
d6.edge("judges", "human", sa="r", sb="l", label="disagree", ly=-6)
d6.edge("cand", "registry", sa="b", sb="t")
d6.edge("registry", "assemble", sa="r", sb="l")
d6.edge("assemble", "dataset", sa="r", sb="l")
d6.edge("dataset", "private", sa="r", sb="l", tone="var(--info)", dashed=True)

import json
import pathlib
import re
import sys

DIAGRAMS = {
    "DIAGRAM_DEPS": d1,
    "DIAGRAM_RUNTIME": d2,
    "DIAGRAM_SEARCH": d3,
    "DIAGRAM_REDACT": d4,
    "DIAGRAM_ERD": d5,
    "DIAGRAM_CORPUS": d6,
}


def check(diagram, name):
    """Fail loudly on the two bugs that are invisible until rendered."""
    problems = []
    boxes = [(n["x"], n["y"], n["w"], n["h"]) for n in diagram.nodes.values()]

    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            ax, ay, aw, ah = boxes[i]
            bx, by, bw, bh = boxes[j]
            if (min(ax + aw, bx + bw) - max(ax, bx) > 0
                    and min(ay + ah, by + bh) - max(ay, by) > 0):
                problems.append(f"nodes overlap: {boxes[i]} and {boxes[j]}")

    for x, y, w, h in boxes:
        if x < 0 or y < 0 or x + w > diagram.w or y + h > diagram.h:
            problems.append(
                f"node ({x},{y},{w},{h}) falls outside viewBox "
                f"{diagram.w}x{diagram.h}"
            )

    svg = diagram.render()
    defined = set(re.findall(r'<marker id="([^"]+)"', svg))
    referenced = set(re.findall(r"url\(#([^)]+)\)", svg))
    for dangling in sorted(referenced - defined):
        problems.append(f"marker reference has no definition: {dangling}")

    for problem in problems:
        print(f"  FAIL {name}: {problem}", file=sys.stderr)
    return not problems


def main():
    rendered, ok = {}, True
    for name, diagram in DIAGRAMS.items():
        ok &= check(diagram, name)
        rendered[name] = diagram.render()
    if not ok:
        raise SystemExit("geometry checks failed; nothing written")

    here = pathlib.Path(__file__).resolve().parent
    (here / "diagrams.json").write_text(json.dumps(rendered), encoding="utf-8")
    print("generated " + ", ".join(f"{k} ({len(v)}b)" for k, v in rendered.items()))

    if "--apply" not in sys.argv:
        print("re-run with --apply to rewrite docs/architecture.html")
        return

    page = here.parent / "docs" / "architecture.html"
    html = page.read_text(encoding="utf-8")
    for name, diagram in DIAGRAMS.items():
        pattern = re.compile(
            r'<svg[^>]*aria-labelledby="%s".*?</svg>' % re.escape(diagram.title_id()),
            re.S,
        )
        if len(pattern.findall(html)) != 1:
            raise SystemExit(f"expected exactly one {name} in the page")
        html = pattern.sub(lambda _m, v=rendered[name]: v, html, count=1)
    page.write_text(html, encoding="utf-8")
    print(f"rewrote {page}; run prettier --write on it")


if __name__ == "__main__":
    main()
