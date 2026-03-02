/**
 * UOM (Unit of Measure) formatting for ISY property values.
 *
 * The ISY uses numeric UOM codes to indicate what unit a property is in.
 * This module converts those to human-readable strings.
 *
 * Reference: ISY UOM table (from nodeDefId documentation)
 */

/** Map of ISY UOM codes to labels and formatters */
const UOM_MAP: Record<string, { label: string; format: (v: number, prec?: number) => string }> = {
  // Percentage
  '17': { label: '%', format: (v) => `${v}%` },
  '51': { label: '%', format: (v) => `${Math.round((v / 255) * 100)}%` },
  '100': { label: '%', format: (v) => `${v}%` },

  // Temperature
  '4': { label: '°F', format: (v, p) => `${(p ? v / 10 ** p : v).toFixed(p ? 1 : 0)}°F` },
  '17.1': { label: '°C', format: (v, p) => `${(p ? v / 10 ** p : v).toFixed(p ? 1 : 0)}°C` },

  // Boolean / On-Off
  '2': { label: '', format: (v) => (v ? 'True' : 'False') },
  '11': { label: '', format: (v) => (v ? 'Dead' : 'Alive') },
  '25': { label: '', format: (v) => INDEX_LABELS[String(v)] ?? String(v) },

  // Seconds / Time
  '56': { label: 's', format: (v) => `${v}s` },
  '57': { label: 'min', format: (v) => `${v}min` },
  '58': { label: 'hrs', format: (v) => `${v}hrs` },

  // Electrical
  '33': { label: 'V', format: (v, p) => `${(p ? v / 10 ** p : v).toFixed(p ? 1 : 0)}V` },
  '1': { label: 'A', format: (v, p) => `${(p ? v / 10 ** p : v).toFixed(p ? 2 : 0)}A` },
  '73': { label: 'W', format: (v, p) => `${(p ? v / 10 ** p : v).toFixed(p ? 1 : 0)}W` },
  '33.1': { label: 'kWh', format: (v, p) => `${(p ? v / 10 ** p : v).toFixed(p ? 2 : 0)}kWh` },

  // Humidity
  '22': { label: '%RH', format: (v) => `${v}%RH` },

  // Level / Byte
  '0': { label: '', format: (v) => String(v) },

  // Lock states (per ISY convention)
  '11.1': { label: '', format: (v) => (v === 100 ? 'Locked' : 'Unlocked') },

  // Index (enums like thermostat mode)
  '68': { label: '', format: (v) => THERMO_MODES[v] ?? String(v) },
  '67': { label: '', format: (v) => THERMO_FAN_MODES[v] ?? String(v) },
  '66': { label: '', format: (v) => THERMO_STATES[v] ?? String(v) },
};

/** Thermostat mode names */
const THERMO_MODES: Record<number, string> = {
  0: 'Off',
  1: 'Heat',
  2: 'Cool',
  3: 'Auto',
  4: 'Fan Only',
  5: 'Program Auto',
  6: 'Program Heat',
  7: 'Program Cool',
};

const THERMO_FAN_MODES: Record<number, string> = {
  0: 'Auto',
  1: 'On',
  2: 'Auto High',
  3: 'On High',
};

const THERMO_STATES: Record<number, string> = {
  0: 'Idle',
  1: 'Heating',
  2: 'Cooling',
  3: 'Fan Only',
  4: 'Pending Heat',
  5: 'Pending Cool',
};

/** Index-based labels (UOM 25) for various properties */
const INDEX_LABELS: Record<string, string> = {
  '0': 'Off',
  '1': 'On',
  '2': 'Occupied',
  '3': 'Unoccupied',
};

/**
 * Format a property value using its UOM code.
 * Falls back to raw value if UOM is unrecognized.
 */
export function formatUom(value: number, uom: string | number, prec?: number): string {
  const uomStr = String(uom);
  const entry = UOM_MAP[uomStr];

  if (entry) {
    return entry.format(value, prec);
  }

  // Apply precision even without known UOM
  if (prec && prec > 0) {
    return (value / 10 ** prec).toFixed(prec);
  }

  return String(value);
}

/** Get the unit label for a UOM code */
export function getUomLabel(uom: string | number): string {
  const entry = UOM_MAP[String(uom)];
  return entry?.label ?? '';
}
