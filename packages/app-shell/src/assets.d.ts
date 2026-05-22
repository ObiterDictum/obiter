interface ImportMetaEnv {
  readonly DEV: boolean
  readonly VITE_ORMONT_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
