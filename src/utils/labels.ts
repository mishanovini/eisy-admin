/**
 * Intelligent labeling — maps raw device properties to human-readable text.
 *
 * Examples:
 *   Door sensor: ST=255/0 → "Open" / "Closed"
 *   Lock: ST=100/0 → "Locked" / "Unlocked"
 *   Motion sensor: ST=255/0 → "Motion Detected" / "Clear"
 *   Dimmer: ST=0-255 → "Off" / "1-100%"
 *   Thermostat: CLISPH/CLISPC → "72°F Heating"
 *   Battery: BATLVL → "85% (Good)" / "15% (Low!)"
 */
import type { IsyProperty } from '@/api/types.ts';
import { formatUom } from './units.ts';
import { formatRampRate } from './scene-utils.ts';
import { getDeviceCategory, type DeviceCategory } from './device-types.ts';

/** Format a property value based on device category and property ID */
export function formatPropertyValue(
  prop: IsyProperty,
  category: DeviceCategory,
): string {
  const id = prop['@_id'];
  const rawValue = Number(prop['@_value']);
  const formatted = prop['@_formatted'];
  const uom = String(prop['@_uom'] ?? '');

  // Use formatted value from eisy if available and it looks useful
  if (formatted && formatted !== '' && formatted !== String(rawValue)) {
    return formatted;
  }

  // Battery level
  if (id === 'BATLVL') {
    return formatBattery(rawValue);
  }

  // Status (ST) — context-dependent
  if (id === 'ST') {
    return formatStatus(rawValue, category, uom);
  }

  // Ramp Rate — index into Insteon ramp rate table (0-31 → "0.1 sec" to "9 min")
  if (id === 'RR') {
    return formatRampRate(rawValue);
  }

  // On Level — format as percentage (0-255 → 0-100%)
  if (id === 'OL') {
    if (rawValue === 0) return 'Off';
    return `${Math.round((rawValue / 255) * 100)}%`;
  }

  // Temperature properties
  if (id === 'CLISPH' || id === 'CLISPC' || id === 'CLITEMP') {
    return formatTemperature(rawValue, prop['@_prec'], uom);
  }

  // Generic: use UOM formatter
  if (uom) {
    return formatUom(rawValue, uom, prop['@_prec']);
  }

  return String(rawValue);
}

/** Format ST (Status) based on device category */
function formatStatus(value: number, category: DeviceCategory, uom: string): string {
  switch (category) {
    case 'door-sensor':
      return value > 0 ? 'Open' : 'Closed';

    case 'lock':
      return value >= 100 ? 'Locked' : 'Unlocked';

    case 'motion-sensor':
      return value > 0 ? 'Motion Detected' : 'Clear';

    case 'leak-sensor':
      return value > 0 ? 'Wet (Leak!)' : 'Dry';

    case 'dimmer':
      if (value === 0) return 'Off';
      // ISY uses 0-255 for dimmers; convert to percentage
      if (uom === '100') return `${value}%`; // already percentage
      return `${Math.round((value / 255) * 100)}%`;

    case 'switch':
    case 'relay':
      return value > 0 ? 'On' : 'Off';

    case 'fan':
      if (value === 0) return 'Off';
      if (value <= 85) return 'Low';
      if (value <= 170) return 'Medium';
      return 'High';

    case 'garage-door':
      return value > 0 ? 'Open' : 'Closed';

    case 'thermostat':
      return formatTemperature(value, undefined, uom);

    default:
      if (value === 0) return 'Off';
      if (value === 255) return 'On';
      return String(value);
  }
}

/** Format battery level with urgency indicator */
function formatBattery(value: number): string {
  if (value <= 10) return `${value}% (Critical!)`;
  if (value <= 25) return `${value}% (Low!)`;
  if (value <= 50) return `${value}% (Fair)`;
  return `${value}% (Good)`;
}

/** Format temperature value */
function formatTemperature(value: number, prec?: number, uom?: string): string {
  const temp = prec ? value / 10 ** prec : value;
  const unit = uom === '4' ? '°C' : '°F';
  return `${temp.toFixed(prec ? 1 : 0)}${unit}`;
}

/** Get a human-readable property name */
export function formatPropertyName(propId: string): string {
  const names: Record<string, string> = {
    ST: 'Status',
    BATLVL: 'Battery Level',
    CLITEMP: 'Temperature',
    CLISPH: 'Heat Setpoint',
    CLISPC: 'Cool Setpoint',
    CLIHUM: 'Humidity',
    CLIHCS: 'Climate State',
    CLIFS: 'Fan State',
    CLIMD: 'Mode',
    LUTEFX: 'LED Effect',
    LUTEFR: 'LED Frequency',
    OL: 'On Level',
    RR: 'Ramp Rate',
    GV1: 'Button Press',
    GV2: 'Button Hold',
    ERR: 'Error',
    CV: 'Current Value',
    TPW: 'Total Power',
    CC: 'Current',
    PPW: 'Power',
  };
  return names[propId] ?? propId;
}

/** Get the primary display value for a node (its ST property, formatted) */
export function getNodeDisplayValue(
  nodeAddress: string,
  nodeDefId: string | undefined,
  getProperty: (address: string, propId: string) => IsyProperty | undefined,
  nodeType?: string,
): string {
  const stProp = getProperty(nodeAddress, 'ST');
  if (!stProp) return 'Unknown';

  const category = getDeviceCategory(nodeDefId, nodeType);
  return formatPropertyValue(stProp, category);
}
