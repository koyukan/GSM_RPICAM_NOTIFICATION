// src/util/env.ts
/**
 * Get environment variable value safely
 * @param key The environment variable key
 * @param defaultValue Optional default value
 * @returns The environment variable value or default
 */
export function getEnv(key: string, defaultValue = ''): string {
    // We need to disable the rule here to access env vars
    // eslint-disable-next-line n/no-process-env
    return process.env[key] ?? defaultValue;
  }
  
  /**
   * Get boolean environment variable
   * @param key The environment variable key
   * @param defaultValue Optional default value
   * @returns The parsed boolean value
   */
  export function getBoolEnv(key: string, defaultValue = false): boolean {
    const value = getEnv(key, String(defaultValue));
    return value.toLowerCase() === 'true';
  }