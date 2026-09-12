export declare function duplicateEnvKeyMessage(
  envFile: string,
  key: string,
): string

export declare function collectEnvKeys(source: string): string[]

export declare function assertNoDuplicateEnvKeys(envFile: string): void
