export function redactMessage(message: string): string {
  return message
    .replace(/(?:https?:\/\/|file:\/\/)[^\s"'<>]+/gi, '[url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(
      /"[^"]*"|'[^']*'|\u201c[^\u201d]*\u201d|\u2018[^\u2019]*\u2019/g,
      '[quoted]',
    )
    .replace(/\d{6,}/g, '[number]')
    .replace(/\S{41,}/g, '[long]')
    .slice(0, 300)
}

const routeSegments = new Set(
  'staff errors telemetry overview usage feedback api matters documents users organisations auth sign-in sign-out sign-up search fetch redact redaction runs versions comments replies shares sources verify findings settings account health access-requests changelog assets index.html outputs presence updates invites sessions me password reset verify-email case-law legislation acts provisions authorities files upload download'.split(
    ' ',
  ),
)

export function routePattern(raw: string): string {
  const path =
    raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '/'
  return (
    '/' +
    path
      .split('/')
      .filter(Boolean)
      .map((part) =>
        routeSegments.has(part) || /^[:$][a-zA-Z]+$/.test(part)
          ? part
          : ':value',
      )
      .join('/')
  ).slice(0, 1000)
}

export function sourceFile(raw: string): string {
  const file = raw.split(/[?#]/)[0]?.split(/[/\\]/).pop() ?? ''
  return file.length <= 200 && /^[a-zA-Z0-9_.-]+\.(?:[cm]?js|tsx?)$/.test(file)
    ? file
    : '[file]'
}

export function errorFrames(error: unknown) {
  if (!(error instanceof Error)) return []
  return (error.stack ?? '')
    .split('\n')
    .slice(1, 31)
    .flatMap((line) => {
      const match = line.match(/(?:at\s+(.*?)\s+\()?([^\s()]+):(\d+):(\d+)\)?$/)
      return match
        ? [
            {
              function: redactMessage(match[1] ?? ''),
              file: sourceFile(match[2] ?? ''),
              line: Number(match[3]),
              column: Number(match[4]),
            },
          ]
        : []
    })
}
