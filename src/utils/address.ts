/**
 * Insteon and Z-Wave address formatting utilities.
 *
 * Insteon addresses: "XX YY ZZ N" (e.g., "56 7D E7 1")
 * Z-Wave addresses: "ZW001_1" or "n001_nodeDef_XX"
 * Node server addresses: "n001_irbutton_1"
 */

/**
 * Format an address for display.
 *
 * Insteon addresses are normalized to "XX.YY.ZZ" (6 uppercase hex chars with
 * dots, leading zeros preserved). The sub-node number is appended only when
 * it is not "1" (the main device node).
 *
 * Z-Wave and other addresses are returned as-is.
 */
export function formatAddress(address: string): string {
  if (!address) return '';
  const trimmed = String(address).trim();

  // Insteon: "XX YY ZZ N" → "XX.YY.ZZ" or "XX.YY.ZZ.N"
  const insteon = parseInsteonAddress(trimmed);
  if (insteon) {
    const parts = insteon.id.split(/\s+/);
    const hex = parts.map((p) => p.toUpperCase().padStart(2, '0')).join('.');
    // Only show sub-node if it's not the main node (1)
    return insteon.subNode === 1 ? hex : `${hex}.${insteon.subNode}`;
  }

  return trimmed;
}

/**
 * Format an Insteon address as the 6-char hex ID only (XX.YY.ZZ),
 * ignoring the sub-node. Returns the original address for non-Insteon.
 */
export function formatInsteonId(address: string): string {
  const insteon = parseInsteonAddress(String(address).trim());
  if (insteon) {
    const parts = insteon.id.split(/\s+/);
    return parts.map((p) => p.toUpperCase().padStart(2, '0')).join('.');
  }
  return String(address).trim();
}

/** Check if an address is an Insteon address (contains hex groups with spaces) */
export function isInsteonAddress(address: string): boolean {
  // Sub-node can be decimal (1, 2, 3) or hex-like (A, D for 10, 13)
  return /^[0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]+$/i.test(String(address).trim());
}

/** Check if an address is a Z-Wave address (ZW=generic, ZY=Yale, ZL=locks, etc.) */
export function isZWaveAddress(address: string): boolean {
  return /^Z[WYLR]\d{3}/i.test(String(address).trim());
}

/** Check if an address is a node server address */
export function isNodeServerAddress(address: string): boolean {
  return /^n\d{3}_/i.test(String(address).trim());
}

/** Get the protocol family from an address */
export function getProtocolFamily(address: string): 'insteon' | 'zwave' | 'nodeserver' | 'unknown' {
  if (isInsteonAddress(address)) return 'insteon';
  if (isZWaveAddress(address)) return 'zwave';
  if (isNodeServerAddress(address)) return 'nodeserver';
  return 'unknown';
}

/** Parse an Insteon address into its components */
export function parseInsteonAddress(address: string): { id: string; subNode: number } | null {
  // Sub-node can be decimal (1, 2) or hex-like (D, A — ISY uses both formats)
  const match = String(address).trim().match(/^([0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2}\s[0-9A-Fa-f]{1,2})\s([0-9A-Fa-f]+)$/i);
  if (!match) return null;
  // Parse sub-node: try decimal first, if it contains hex letters use parseInt(16)
  const subStr = match[2]!;
  const subNode = /[A-Fa-f]/.test(subStr) ? parseInt(subStr, 16) : parseInt(subStr, 10);
  return { id: match[1]!, subNode };
}

/** Get the base Insteon device address (sub-node 1) */
export function getBaseAddress(address: string): string {
  const parsed = parseInsteonAddress(address);
  if (!parsed) return address;
  return `${parsed.id} 1`;
}

/**
 * Parse a Z-Wave address into its components.
 * Z-Wave addresses: "ZW007_1", "ZY007_2", "ZL003_1", etc.
 * Returns the prefix+number (e.g., "ZW007") and the endpoint number.
 */
export function parseZWaveAddress(address: string): { base: string; endpoint: number } | null {
  const match = String(address).trim().match(/^(Z[WYLR]\d{3})_(\d+)$/i);
  if (!match) return null;
  return { base: match[1]!, endpoint: parseInt(match[2]!, 10) };
}

/**
 * Get the base Z-Wave device address (endpoint 1).
 * "ZW007_2" → "ZW007_1", "ZY007_3" → "ZY007_1"
 */
export function getBaseZWaveAddress(address: string): string {
  const parsed = parseZWaveAddress(address);
  if (!parsed) return address;
  return `${parsed.base}_1`;
}

/**
 * Get the primary physical device address, regardless of protocol.
 *
 * Multi-node devices (Insteon remotes with buttons A-D, Z-Wave locks with
 * alarm/sensor endpoints) all share a single physical device. This function
 * returns the "main" address for any sub-node:
 * - Insteon: "56 7D E7 3" → "56 7D E7 1"
 * - Z-Wave: "ZW007_2" → "ZW007_1"
 * - Other: returned as-is
 */
export function getPhysicalDeviceAddress(address: string): string {
  const addr = String(address).trim();
  if (isInsteonAddress(addr)) return getBaseAddress(addr);
  if (isZWaveAddress(addr)) return getBaseZWaveAddress(addr);
  return addr;
}

/** Convert a decimal program ID to 4-digit uppercase hex */
export function programIdToHex(id: number): string {
  return id.toString(16).toUpperCase().padStart(4, '0');
}

/** Convert a hex program ID to decimal */
export function hexToProgramId(hex: string): number {
  return parseInt(hex, 16);
}
