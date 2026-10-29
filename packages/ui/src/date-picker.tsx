import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { cn } from './lib/cn'

/**
 * DatePicker — a date field for a UK legal workspace: the visible and typed
 * format is dd/mm/yyyy, and the value crossing the component boundary is an
 * ISO `YYYY-MM-DD` string (or '' for no date). The browser's
 * `<input type="date">` renders in the browser's locale, which put mm/dd/yyyy
 * in front of every user here, so the field is a text input with its own
 * calendar rather than a formatted native control.
 *
 * The calendar expands beneath the field instead of floating: a date filter
 * sits in a side column with room below it, and a floating layer would tie the
 * search route to the shell's whole overlay graph for one grid.
 */

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const weekdayInitials = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** dd/mm/yyyy to ISO, or null when the text is not a real date. */
export function parseDdMmYyyy(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const [, day, month, year] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  // Rejects 31/02 and friends: the components must survive the round trip.
  if (
    date.getUTCDate() !== Number(day) ||
    date.getUTCMonth() !== Number(month) - 1
  ) {
    return null
  }
  return toIsoDate(date)
}

/** ISO (YYYY-MM-DD) to dd/mm/yyyy, or '' when there is no date. */
export function formatDdMmYyyy(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

/** The days of a month grid, Monday first, with blanks before the 1st. */
export function monthCells(year: number, month: number): Array<number | null> {
  const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]
}

export interface DatePickerProps {
  label?: ReactNode
  /** ISO `YYYY-MM-DD`, or '' for no date. */
  value: string
  onChange: (iso: string) => void
  name?: string
  className?: string
  helperText?: ReactNode
}

export function DatePicker({
  label,
  value,
  onChange,
  name,
  className,
  helperText,
}: DatePickerProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  // `draft` holds the typed text while it is being edited: half a date
  // ("12/0") is not a value, and pushing it up would either invent one or
  // fight the user's keystrokes. Null means "show the value", so an external
  // change (a cleared filter chip) needs no effect to reach the field.
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(value))
  const text = draft ?? formatDdMmYyyy(value)
  const calendarId = `${id}-calendar`
  const calendarLabel = typeof label === 'string' ? `${label} date` : 'Date'

  function commit(nextText: string) {
    const iso = parseDdMmYyyy(nextText)
    if (iso !== null) onChange(iso)
    else if (nextText.trim() === '') onChange('')
    // Anything else is not a date: fall back to what is committed rather
    // than leaving text that claims a value the filter does not hold.
    setDraft(null)
  }

  function pick(day: number) {
    const iso = toIsoDate(
      new Date(Date.UTC(visibleMonth.year, visibleMonth.month, day)),
    )
    onChange(iso)
    setDraft(null)
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label ? (
        <label htmlFor={id} className="text-meta text-ink">
          {label}
        </label>
      ) : null}
      <div className="relative flex items-center">
        <input
          id={id}
          ref={inputRef}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/yyyy"
          value={text}
          aria-describedby={helperText ? `${id}-describe` : undefined}
          className={cn(
            'h-control w-full rounded-md border bg-raised px-3 pr-9 text-meta text-ink tabular-nums',
            'placeholder:text-subtle',
            'transition-[border-color,box-shadow] duration-150',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'border-line hover:border-strong',
          )}
          onChange={(event) => {
            setDraft(event.target.value)
            const iso = parseDdMmYyyy(event.target.value)
            if (iso !== null) onChange(iso)
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(event.currentTarget.value)
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
            }
          }}
        />
        <button
          ref={toggleRef}
          type="button"
          aria-label={`Choose ${calendarLabel}`}
          aria-expanded={open}
          aria-controls={calendarId}
          className={cn(
            'absolute right-1 inline-flex size-7 items-center justify-center rounded-sm text-subtle',
            'hover:bg-hover hover:text-ink',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          )}
          onClick={() => {
            setOpen((current) => {
              if (!current) setVisibleMonth(monthOf(value))
              return !current
            })
          }}
        >
          <CalendarBlank aria-hidden size={14} />
        </button>
      </div>
      {open ? (
        <div
          id={calendarId}
          role="group"
          aria-label={`${calendarLabel} calendar`}
          className="rounded-md border border-line bg-raised p-3"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setOpen(false)
            toggleRef.current?.focus()
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              className="inline-flex size-7 items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() =>
                setVisibleMonth((current) => shiftMonth(current, -1))
              }
            >
              <CaretLeft aria-hidden size={14} />
            </button>
            <span aria-live="polite" className="text-meta text-ink">
              {monthNames[visibleMonth.month]} {visibleMonth.year}
            </span>
            <button
              type="button"
              aria-label="Next month"
              className="inline-flex size-7 items-center justify-center rounded-sm text-subtle hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() =>
                setVisibleMonth((current) => shiftMonth(current, 1))
              }
            >
              <CaretRight aria-hidden size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {weekdayInitials.map((initial, index) => (
              <span
                key={`${initial}-${index}`}
                aria-hidden
                className="pb-1 text-caption text-subtle"
              >
                {initial}
              </span>
            ))}
            {monthCells(visibleMonth.year, visibleMonth.month).map(
              (day, index) =>
                day === null ? (
                  <span key={`blank-${index}`} />
                ) : (
                  <button
                    key={day}
                    type="button"
                    aria-label={`${day} ${monthNames[visibleMonth.month]} ${visibleMonth.year}`}
                    aria-current={
                      isSelected(visibleMonth, day, value) || undefined
                    }
                    className={cn(
                      'flex size-7 items-center justify-center rounded-sm text-caption tabular-nums',
                      'hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      'aria-[current=true]:bg-brand aria-[current=true]:text-brand-fg',
                    )}
                    onClick={() => pick(day)}
                  >
                    {day}
                  </button>
                ),
            )}
          </div>
        </div>
      ) : null}
      {helperText ? (
        <p id={`${id}-describe`} className="text-caption text-subtle">
          {helperText}
        </p>
      ) : null}
    </div>
  )
}

function monthOf(iso: string): { year: number; month: number } {
  const today = new Date()
  return iso
    ? { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1 }
    : { year: today.getFullYear(), month: today.getMonth() }
}

function shiftMonth(current: { year: number; month: number }, by: number) {
  const date = new Date(Date.UTC(current.year, current.month + by, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

function isSelected(
  visible: { year: number; month: number },
  day: number,
  value: string,
) {
  return (
    value === toIsoDate(new Date(Date.UTC(visible.year, visible.month, day)))
  )
}
