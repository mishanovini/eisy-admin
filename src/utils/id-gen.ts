/**
 * ID generators for creating new scenes, programs, and folders.
 *
 * The eisy uses different ID schemes per entity type:
 * - Scenes: numeric addresses (e.g. "30001", "30002")
 * - Programs: decimal IDs displayed as 4-digit hex (e.g. ID 1 → "0001")
 * - Folders: numeric IDs
 */
import type { IsyGroup, IsyFolder } from '@/api/types.ts';
import type { D2DTrigger } from '@/api/types.ts';

/**
 * Find the next available scene address.
 * Scenes typically start at 30001 and increment. We scan all existing
 * scene addresses and return max + 1.
 */
export function nextSceneAddress(existingScenes: IsyGroup[]): string {
  const BASE = 30001;
  let max = BASE - 1;

  for (const s of existingScenes) {
    const addr = parseInt(String(s.address), 10);
    if (!isNaN(addr) && addr > max) max = addr;
  }

  return String(max + 1);
}

/**
 * Find the next available program ID (decimal).
 * Programs use sequential decimal IDs. We find the highest existing
 * trigger ID and return +1.
 */
export function nextProgramId(existingTriggers: D2DTrigger[]): number {
  let max = 0;

  for (const t of existingTriggers) {
    if (t.id > max) max = t.id;
  }

  return max + 1;
}

/**
 * Find the next available folder ID.
 * Device tree folders use numeric string IDs.
 */
export function nextFolderId(existingFolders: IsyFolder[]): string {
  let max = 0;

  for (const f of existingFolders) {
    const id = parseInt(String(f.address), 10);
    if (!isNaN(id) && id > max) max = id;
  }

  return String(max + 1);
}
