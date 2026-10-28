import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/*
 * tailwind-merge does not know the semantic type scale from tailwind.css, so it
 * classifies `text-item`/`text-body`/… as text colours and drops a real colour
 * utility that sits beside them (e.g. `text-brand-fg` on a primary button).
 * Register the six levels as font sizes so size and colour merge independently.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['page', 'section', 'item', 'body', 'meta', 'caption'] },
      ],
    },
  },
})

/**
 * Merge Tailwind utility classes with conflict resolution.
 * clsx handles conditional values; twMerge dedupes conflicting utilities.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
