/**
 * .env file read/write utility.
 *
 * Reads and updates .env files without disturbing comments or ordering.
 * Used by vite.config.ts and deploy.ts to persist discovered eisy settings.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';

// ─── Types ──────────────────────────────────────────────────────

export interface EnvUpdateResult {
  changed: boolean;
  previousValues: Record<string, string>;
  newValues: Record<string, string>;
}

// ─── Read ───────────────────────────────────────────────────────

/**
 * Parse a .env file into a key-value record.
 * Ignores comments and empty lines. Does not expand variables.
 */
export function readEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};

  const content = readFileSync(envPath, 'utf-8');
  const vars: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars[key] = value;
  }

  return vars;
}

// ─── Write ──────────────────────────────────────────────────────

/**
 * Update specific keys in a .env file.
 *
 * - Preserves comments, ordering, and unrelated keys
 * - Creates the file from .env.example if it doesn't exist
 * - Only writes if at least one value actually changed
 *
 * Returns which values changed (for logging).
 */
export function updateEnvFile(
  envPath: string,
  updates: Record<string, string>,
): EnvUpdateResult {
  // Create from .env.example if missing
  if (!existsSync(envPath)) {
    const examplePath = resolve(dirname(envPath), '.env.example');
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, envPath);
    } else {
      writeFileSync(envPath, '', 'utf-8');
    }
  }

  const content = readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  const previousValues: Record<string, string> = {};
  const newValues: Record<string, string> = {};
  const updatedKeys = new Set<string>();

  // Update existing lines
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return line;

    const key = trimmed.slice(0, eqIdx).trim();
    if (key in updates) {
      const oldValue = trimmed.slice(eqIdx + 1).trim();
      const newValue = updates[key]!;
      updatedKeys.add(key);

      if (oldValue !== newValue) {
        previousValues[key] = oldValue;
        newValues[key] = newValue;
        return `${key}=${newValue}`;
      }
    }
    return line;
  });

  // Append keys that weren't found in existing lines
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      previousValues[key] = '';
      newValues[key] = value;
      updatedLines.push(`${key}=${value}`);
    }
  }

  const changed = Object.keys(newValues).length > 0;
  if (changed) {
    writeFileSync(envPath, updatedLines.join('\n'), 'utf-8');
  }

  return { changed, previousValues, newValues };
}
