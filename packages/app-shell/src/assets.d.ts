interface ImportMetaEnv {
  readonly DEV: boolean
  readonly VITE_DEV_AUTO_LOGIN?: string
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
