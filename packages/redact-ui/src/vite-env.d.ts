interface ImportMetaEnv {
  readonly DEV: boolean
  readonly [key: string]: string | boolean | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.png' {
  const source: string
  export default source
}
