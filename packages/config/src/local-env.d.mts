export declare function resolveLocalEnvFile(
  startDirectory: string,
): string | null

export declare function parseLocalEnvFile(envPath: string): Map<string, string>

export declare function loadLocalEnvFile(startDirectory?: string): string | null
