/**
 * Elements whose own key semantics belong to the browser once focused. The
 * result-navigation shortcuts are bound at the window, so they must decline
 * to fire when the event came from one of these: Enter on a focused button or
 * link activates it, and arrows move a caret or a listbox option.
 *
 * Naming the roles alongside the elements keeps the guard honest for the
 * custom controls that render a `div` with `role="button"` rather than a
 * native element.
 */
const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(',')

/**
 * True when the event target is an interactive control or sits inside one.
 *
 * `closest` is deliberate: a keydown inside a control usually targets a
 * nested span, icon or text node, so a predicate that only tested the target
 * itself would let the window shortcut steal the control's keys.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(INTERACTIVE_SELECTOR) !== null
}
