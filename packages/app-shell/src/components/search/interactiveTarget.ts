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

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(INTERACTIVE_SELECTOR) !== null
}
