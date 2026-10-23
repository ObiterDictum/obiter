import { childrenByParent, isWord, type XmlElement } from './xml-elements'
import { isTrackedChange } from './tracked-change-nodes'

const NO_ELEMENTS: readonly XmlElement[] = []

/**
 * One pass over a part's element list, indexing what the story walk asks for
 * over and over: children, the nearest enclosing `w:r`/`w:p`, and the tracked
 * change and `mc:Fallback` facts. Without it every paragraph and every run
 * scans the whole list, so a part costs runs × elements — 2,000 field-bearing
 * paragraphs took ~30 s before this. Elements are in document order, so a
 * parent is always seen before its children: ancestor facts are computed
 * forward and subtree facts backward, with no recursion (a part may nest
 * 20,000 deep).
 */
export class PartIndex {
  private readonly children: Map<XmlElement, XmlElement[]>
  private readonly byRun = new Map<XmlElement, XmlElement[]>()
  private readonly byParagraph = new Map<XmlElement, XmlElement[]>()
  private readonly nearestRun = new Map<XmlElement, XmlElement | undefined>()
  private readonly nearestParagraph = new Map<
    XmlElement,
    XmlElement | undefined
  >()
  private readonly trackedAncestor = new Set<XmlElement>()
  private readonly insideFallback = new Set<XmlElement>()
  private readonly trackedSubtree = new Set<XmlElement>()

  constructor(private readonly elements: readonly XmlElement[]) {
    this.children = childrenByParent(elements)
    for (const element of elements) {
      const parent = element.parent
      if (parent !== undefined) {
        if (isTrackedChange(parent) || this.trackedAncestor.has(parent)) {
          this.trackedAncestor.add(element)
        }
        if (
          parent.localName === 'Fallback' ||
          this.insideFallback.has(parent)
        ) {
          this.insideFallback.add(element)
        }
      }
      const run =
        parent === undefined
          ? undefined
          : isWord(parent, 'r')
            ? parent
            : this.nearestRun.get(parent)
      this.nearestRun.set(element, run)
      this.bucket(this.byRun, run, element)
      const paragraph =
        parent === undefined
          ? undefined
          : isWord(parent, 'p')
            ? parent
            : this.nearestParagraph.get(parent)
      this.nearestParagraph.set(element, paragraph)
      this.bucket(this.byParagraph, paragraph, element)
    }
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index]
      if (isTrackedChange(element)) {
        this.trackedSubtree.add(element)
        continue
      }
      for (const child of this.children.get(element) ?? NO_ELEMENTS) {
        if (this.trackedSubtree.has(child)) {
          this.trackedSubtree.add(element)
          break
        }
      }
    }
  }

  root() {
    return this.elements.find(({ depth }) => depth === 0)
  }

  childrenOf(element: XmlElement) {
    return this.children.get(element) ?? NO_ELEMENTS
  }

  /** Elements whose nearest enclosing `w:r` is `run`, in document order. */
  descendantsOfRun(run: XmlElement) {
    return this.byRun.get(run) ?? NO_ELEMENTS
  }

  /** Elements whose nearest enclosing `w:p` is `paragraph`. */
  descendantsOfParagraph(paragraph: XmlElement) {
    return this.byParagraph.get(paragraph) ?? NO_ELEMENTS
  }

  inTrackedChange(element: XmlElement) {
    return this.trackedAncestor.has(element)
  }

  isInsideFallback(element: XmlElement) {
    return this.insideFallback.has(element)
  }

  /** The element itself or a descendant is a tracked change. */
  containsTrackedChange(element: XmlElement) {
    return this.trackedSubtree.has(element)
  }

  /** A `w:del` on the paragraph's own mark, which deletes the paragraph. */
  hasDeletedParagraphMark(paragraph: XmlElement) {
    const properties = this.childrenOf(paragraph).find((element) =>
      isWord(element, 'pPr'),
    )
    if (!properties) return false
    const mark = this.childrenOf(properties).find((element) =>
      isWord(element, 'rPr'),
    )
    if (!mark) return false
    return this.childrenOf(mark).some((element) => isWord(element, 'del'))
  }

  private bucket(
    into: Map<XmlElement, XmlElement[]>,
    key: XmlElement | undefined,
    element: XmlElement,
  ) {
    if (key === undefined) return
    const entries = into.get(key)
    if (entries) entries.push(element)
    else into.set(key, [element])
  }
}
