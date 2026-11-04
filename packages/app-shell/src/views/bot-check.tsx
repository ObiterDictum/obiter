import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileOptions = {
  sitekey: string
  action?: string
  theme?: 'auto' | 'light' | 'dark'
  appearance?: 'always' | 'execute' | 'interaction-only'
  callback?: (token: string) => void
  'error-callback'?: () => void
  'expired-callback'?: () => void
}

type Turnstile = {
  render: (element: HTMLElement, options: TurnstileOptions) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let scriptLoad: Promise<Turnstile> | undefined

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptLoad ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not load'))
    script.onerror = () => {
      scriptLoad = undefined
      script.remove()
      reject(new Error('Turnstile did not load'))
    }
    document.head.append(script)
  })
  return scriptLoad
}

export type BotCheckState =
  | { status: 'pending' }
  | { status: 'passed'; token: string }
  | { status: 'unavailable' }

export type BotCheckHandle = { reset: () => void }

export const BotCheck = forwardRef<
  BotCheckHandle,
  { siteKey: string; action: string; onChange: (state: BotCheckState) => void }
>(function BotCheck({ siteKey, action, onChange }, ref) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<{ api: Turnstile; id: string } | undefined>(undefined)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useImperativeHandle(ref, () => ({
    reset() {
      if (!widget.current) return
      onChangeRef.current({ status: 'pending' })
      widget.current.api.reset(widget.current.id)
    },
  }))

  useEffect(() => {
    let cancelled = false
    onChangeRef.current({ status: 'pending' })
    loadTurnstile().then(
      (api) => {
        if (cancelled || !container.current) return
        const id = api.render(container.current, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          appearance: 'interaction-only',
          callback: (token) => onChangeRef.current({ status: 'passed', token }),
          'error-callback': () =>
            onChangeRef.current({ status: 'unavailable' }),
          'expired-callback': () => onChangeRef.current({ status: 'pending' }),
        })
        widget.current = { api, id }
      },
      () => {
        if (!cancelled) onChangeRef.current({ status: 'unavailable' })
      },
    )
    return () => {
      cancelled = true
      if (widget.current) widget.current.api.remove(widget.current.id)
      widget.current = undefined
    }
  }, [siteKey, action])

  return <div ref={container} className="empty:hidden" />
})
