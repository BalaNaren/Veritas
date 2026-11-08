/** Variables that are safe and usually necessary for child processes to work. */
export const BASE_ENV_NAMES = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
  'SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
] as const;

/**
 * Build an environment from an explicit list of variable names plus optional
 * extra values. Everything not listed is left out.
 */
export function pickEnv(
  names: readonly string[],
  extra: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'string') env[name] = value;
  }
  return { ...env, ...extra };
}
