if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    setTimeout(() => {
      void fetch('/.well-known/obiter-error-reporting')
        .then((response) => response.json())
        .then(
          async (config: {
            dsn?: string
            release?: string
            production?: boolean
          }) => {
            if (!config.dsn) return
            const { startErrorReporting } =
              await import('@obiter/app-shell/error-reporting')
            await startErrorReporting(
              config.dsn,
              config.release,
              config.production === true,
            )
          },
        )
        .catch(() => console.warn('Error reporting could not start.'))
    }, 0)
  })
}
