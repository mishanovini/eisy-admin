/**
 * Device type → icon, controls, and capabilities mapping.
 * Maps ISY nodeDefId values to UI presentation data.
 */

export type DeviceCategory =
  | 'dimmer'
  | 'switch'
  | 'relay'
  | 'fan'
  | 'lock'
  | 'door-sensor'
  | 'motion-sensor'
  | 'leak-sensor'
  | 'thermostat'
  | 'garage-door'
  | 'ir-button'
  | 'outlet'
  | 'keypad'
  | 'remote'
  | 'io-link'
  | 'repeater'
  | 'scene'
  | 'unknown';

export type ControlType = 'toggle' | 'dimmer' | 'lock' | 'fan' | 'thermostat' | 'button' | 'none';

export interface DeviceTypeInfo {
  category: DeviceCategory;
  icon: string; // Lucide icon name
  label: string; // Human-readable device type
  controls: ControlType;
  hasBattery: boolean;
}

/**
 * Map ISY nodeDefId to device category.
 *
 * @param nodeDefId - The ISY node definition ID (e.g., "DimmerAuto_ADV" for Insteon,
 *                    "ZY007_1" for Z-Wave)
 * @param nodeType  - Optional ISY `<type>` field (e.g., "4.64.3.0"). Critical for Z-Wave
 *                    devices where the nodeDefId is just the address with no descriptive
 *                    keywords. The second number is the Z-Wave Generic Device Class.
 */
export function getDeviceCategory(nodeDefId?: string, nodeType?: string): DeviceCategory {
  if (!nodeDefId) return 'unknown';

  const def = nodeDefId.toLowerCase();

  // Dimmers
  if (def.includes('dimmer') || def.includes('dimmable')) return 'dimmer';
  if (/^(2456d|2457d|2472d|2477d|2334)/i.test(nodeDefId)) return 'dimmer';

  // Outlets — checked BEFORE relay/switch to catch OnOffOutlet_ADV, ApplianceLinc_ADV
  if (def.includes('outlet') || def.includes('appliancelinc')) return 'outlet';

  // Switches / Relays — but first check if a "relay" is actually an outlet via the type field.
  // Insteon On/Off Outlets (2663-222) have nodeDefId "RelayLampSwitch_ADV" but the ISY type
  // field SubCat 57 (0x39) identifies them as outlets. Format: "Category.SubCat.Firmware.Version"
  if (def.includes('relay') || def.includes('iolinc')) {
    if (nodeType && isInsteonOutletType(nodeType)) return 'outlet';
    return 'relay';
  }
  if (def.includes('switch') || def.includes('on_off') || def.includes('onoff')) return 'switch';

  // Fans
  if (def.includes('fan')) return 'fan';

  // Locks
  if (def.includes('lock') || def.includes('deadbolt')) return 'lock';

  // Door/Window sensors
  if (def.includes('door') || def.includes('window') || def.includes('openclose')) return 'door-sensor';

  // Motion sensors — PIR = Passive Infrared (motion sensor model prefix, e.g. PIR2844_ADV)
  if (def.includes('motion') || def.startsWith('pir')) return 'motion-sensor';

  // Leak sensors
  if (def.includes('leak') || def.includes('water')) return 'leak-sensor';

  // Thermostats
  if (def.includes('thermo') || def.includes('climate')) return 'thermostat';

  // Garage
  if (def.includes('garage')) return 'garage-door';

  // Keypads — MUST be checked before 'button' to avoid Insteon Keypad
  // secondary buttons (e.g. KeypadButton_ADv) matching 'ir-button'.
  if (def.includes('keypad') || def.includes('kpl') || def.includes('keypadbutton')) return 'keypad';

  // Keypad-style button nodes (Insteon secondary buttons like Pad.A, Pad.B)
  // that contain 'button' but NOT 'ir' — these are physical light switch buttons.
  if (def.includes('button') && !def.includes('ir')) return 'keypad';

  // IR / Button nodes — match specific IR patterns, NOT substrings like "pir" or "stair"
  if (def.includes('irbutton') || def.includes('ir_button') || /\bir/.test(def) || def.startsWith('ir')) return 'ir-button';

  // (Outlets already checked above, before relay/switch)

  // Remotes
  if (def.includes('remote') || def.includes('remotelinc')) return 'remote';

  // I/O Link
  if (def.includes('iolink') || def.includes('io_link')) return 'io-link';

  // Z-Wave device type patterns (ZW=generic, ZY=Yale, ZL=locks, ZR=other)
  if (/^z[wylr]\d+/i.test(nodeDefId)) {
    // ── Primary: use ISY's <type> field (Z-Wave Generic Device Class) ──
    // The type field format is "routing.generic.specific.version" (e.g., "4.64.3.0").
    // The generic device class (2nd number) is a reliable Z-Wave standard:
    //   15 = Repeater Slave       16 = Binary Switch
    //   17 = Multilevel Switch    33 = Sensor Notification
    //   48 = Binary Sensor        49 = Multilevel Sensor
    //   64 = Entry Control (locks)  113 = Alarm
    if (nodeType) {
      const zwGeneric = classifyZWaveByType(nodeType);
      if (zwGeneric !== null) return zwGeneric;
    }

    // ── Fallback: keyword matching in nodeDefId (rarely useful for Z-Wave) ──
    if (def.includes('repeater')) return 'repeater';
    if (def.includes('dim') || (def.includes('multilevel') && !def.includes('sensor'))) return 'dimmer';
    if (def.includes('binary') || def.includes('switch')) return 'switch';
    if (def.includes('lock') || def.includes('deadbolt')) return 'lock';
    if (def.includes('sensor')) return 'motion-sensor';
    if (def.includes('thermo')) return 'thermostat';
    if (def.includes('alarm') || def.includes('notification')) return 'unknown';
    // Generic Z-Wave device with no type info — best guess is switch
    return 'switch';
  }

  return 'unknown';
}

/**
 * Check if an Insteon device type indicates an outlet (plug-in module).
 *
 * The Insteon type field format is "Category.SubCat.Firmware.Version".
 * SubCat 57 (0x39) = On/Off Outlet (Insteon 2663-222).
 * These devices have nodeDefId "RelayLampSwitch_ADV" but are physically outlets.
 */
function isInsteonOutletType(nodeType: string): boolean {
  const match = nodeType.match(/^2\.(\d+)\./);
  if (!match) return false;
  const subCat = parseInt(match[1]!, 10);
  // SubCat 57 = On/Off Outlet (2663-222)
  return subCat === 57;
}

/**
 * Classify a Z-Wave device using the ISY `<type>` field.
 *
 * The type field encodes the Z-Wave Generic Device Class as the second number
 * in a dotted-quad format: "routing.generic.specific.version".
 *
 * Returns null if the type doesn't match any known Z-Wave class, allowing
 * the caller to fall back to keyword-based matching.
 */
function classifyZWaveByType(nodeType: string): DeviceCategory | null {
  // Extract the generic device class (2nd number in "4.XX.Y.Z")
  const match = nodeType.match(/^4\.(\d+)\./);
  if (!match) return null;

  const generic = parseInt(match[1]!, 10);

  switch (generic) {
    case 15: return 'repeater';       // Repeater Slave (mains-powered signal relay)
    case 16: return 'switch';         // Binary Switch
    case 17: return 'dimmer';         // Multilevel Switch
    case 33: return 'motion-sensor';  // Sensor Notification
    case 48: return 'door-sensor';    // Binary Sensor (door/window)
    case 49: return 'motion-sensor';  // Multilevel Sensor
    case 64: return 'lock';           // Entry Control (door locks)
    case 113: return 'unknown';       // Alarm (sub-node of locks etc.)
    default: return null;             // Unknown — fall through to keyword matching
  }
}

/** Get full device type info from nodeDefId (and optional ISY type field for Z-Wave) */
export function getDeviceTypeInfo(nodeDefId?: string, nodeType?: string): DeviceTypeInfo {
  const category = getDeviceCategory(nodeDefId, nodeType);
  return DEVICE_TYPE_MAP[category];
}

/**
 * Known Insteon/ISY model name lookup from nodeDefId.
 *
 * The ISY doesn't provide a product name field — only the nodeDefId (e.g., "PIR2844_ADV").
 * This table maps known nodeDefIds (or prefixes) to human-readable product names.
 * Unrecognized IDs return null — the UI should fall back to showing the nodeDefId.
 */
const KNOWN_MODELS: Record<string, string> = {
  // ─── Motion Sensors ──────────────────
  'pir2844_adv':       'Insteon Motion Sensor II (2844-222)',
  'pir2844':           'Insteon Motion Sensor II (2844)',
  'pir2420_adv':       'Insteon Motion Sensor (2420)',
  // ─── Dimmers ─────────────────────────
  'dimmerauto_adv':    'Insteon Dimmer (SwitchLinc)',
  'dimmer_adv':        'Insteon Dimmer (SwitchLinc)',
  'dimmable_adv':      'Insteon Dimmable Module',
  'lamplincdimmer_adv':'Insteon LampLinc Dimmer',
  // ─── Switches / Relays ───────────────
  'relaydual_adv':     'Insteon On/Off Dual-Band (2477S)',
  'relay_adv':         'Insteon Relay Module',
  'relaylinc_adv':     'Insteon RelayLinc',
  'onoffswitch_adv':   'Insteon On/Off Switch',
  'iolinc_adv':        'Insteon I/O Linc',
  'appliancelinc_adv': 'Insteon ApplianceLinc',
  // ─── Keypads ─────────────────────────
  'keypaddimmer_adv':  'Insteon Keypad Dimmer (2334-2)',
  'keypadrelay_adv':   'Insteon Keypad Relay',
  'keypadbutton_adv':  'Insteon Keypad Button',
  // ─── Locks ───────────────────────────
  'deadboltlock_adv':  'Insteon Deadbolt Lock',
  // ─── Leak / Water ────────────────────
  'leaksensor_adv':    'Insteon Leak Sensor (2852-222)',
  // ─── Door / Window ───────────────────
  'openclose_adv':     'Insteon Open/Close Sensor (2843-222)',
  'doorwindow_adv':    'Insteon Door/Window Sensor',
  // ─── Outlets ─────────────────────────
  'onoffoutlet_adv':   'Insteon On/Off Outlet (2663-222)',
  // ─── Fan ─────────────────────────────
  'fanlinc_adv':       'Insteon FanLinc (2475F)',
  // ─── Remotes ─────────────────────────
  'remotelinc2_adv':   'Insteon RemoteLinc 2 (2440)',
  // ─── IR ──────────────────────────────
  'irlinc_adv':        'Insteon IRLinc (2411T)',
};

/** Look up a human-readable model name from a nodeDefId. Returns null if unknown. */
export function getModelName(nodeDefId?: string): string | null {
  if (!nodeDefId) return null;
  const key = nodeDefId.toLowerCase();
  // Try exact match first
  if (KNOWN_MODELS[key]) return KNOWN_MODELS[key]!;
  // Try without _adv suffix
  const noAdv = key.replace(/_adv$/, '');
  if (KNOWN_MODELS[noAdv]) return KNOWN_MODELS[noAdv]!;
  if (KNOWN_MODELS[noAdv + '_adv']) return KNOWN_MODELS[noAdv + '_adv']!;
  return null;
}

/** Icon and control mapping per device category */
const DEVICE_TYPE_MAP: Record<DeviceCategory, DeviceTypeInfo> = {
  dimmer: {
    category: 'dimmer',
    icon: 'SunDim',
    label: 'Dimmer',
    controls: 'dimmer',
    hasBattery: false,
  },
  switch: {
    category: 'switch',
    icon: 'ToggleRight',
    label: 'Switch',
    controls: 'toggle',
    hasBattery: false,
  },
  relay: {
    category: 'relay',
    icon: 'Plug',
    label: 'Relay',
    controls: 'toggle',
    hasBattery: false,
  },
  fan: {
    category: 'fan',
    icon: 'Fan',
    label: 'Fan Controller',
    controls: 'fan',
    hasBattery: false,
  },
  lock: {
    category: 'lock',
    icon: 'Lock',
    label: 'Lock',
    controls: 'lock',
    hasBattery: true,
  },
  'door-sensor': {
    category: 'door-sensor',
    icon: 'DoorOpen',
    label: 'Door/Window Sensor',
    controls: 'none',
    hasBattery: true,
  },
  'motion-sensor': {
    category: 'motion-sensor',
    icon: 'Eye',
    label: 'Motion Sensor',
    controls: 'none',
    hasBattery: true,
  },
  'leak-sensor': {
    category: 'leak-sensor',
    icon: 'Droplets',
    label: 'Leak Sensor',
    controls: 'none',
    hasBattery: true,
  },
  thermostat: {
    category: 'thermostat',
    icon: 'Thermometer',
    label: 'Thermostat',
    controls: 'thermostat',
    hasBattery: false,
  },
  'garage-door': {
    category: 'garage-door',
    icon: 'Warehouse',
    label: 'Garage Door',
    controls: 'toggle',
    hasBattery: false,
  },
  'ir-button': {
    category: 'ir-button',
    icon: 'Tv',
    label: 'IR Button',
    controls: 'button',
    hasBattery: false,
  },
  outlet: {
    category: 'outlet',
    icon: 'PlugZap',
    label: 'Outlet',
    controls: 'toggle',
    hasBattery: false,
  },
  keypad: {
    category: 'keypad',
    icon: 'Grid3X3',
    label: 'Keypad',
    controls: 'toggle',
    hasBattery: false,
  },
  remote: {
    category: 'remote',
    icon: 'Radio',
    label: 'Remote',
    controls: 'none',
    hasBattery: true,
  },
  'io-link': {
    category: 'io-link',
    icon: 'Cable',
    label: 'I/O Link',
    controls: 'toggle',
    hasBattery: false,
  },
  repeater: {
    category: 'repeater',
    icon: 'Repeat',
    label: 'Repeater',
    controls: 'none',
    hasBattery: false,
  },
  scene: {
    category: 'scene',
    icon: 'Layers',
    label: 'Scene',
    controls: 'toggle',
    hasBattery: false,
  },
  unknown: {
    category: 'unknown',
    icon: 'HelpCircle',
    label: 'Device',
    controls: 'toggle',
    hasBattery: false,
  },
};

// ─── Battery Thresholds ──────────────────────────────────────

export interface BatteryThreshold {
  /** Battery level (%) at which to show a "Low" warning */
  warn: number;
  /** Battery level (%) at which to show a "Critical" alert */
  critical: number;
  /** Typical battery type for this device category */
  typicalBattery: string;
}

/**
 * Per-device-category battery thresholds.
 *
 * Rationale for different thresholds:
 * - Lithium cells (CR123A, CR2) have a flat discharge curve — they hold
 *   voltage near 100% until rapidly dropping at end-of-life. Lower warn %.
 * - Alkaline cells (AA, AAA) decline gradually, so a higher warn % gives
 *   more lead time.
 * - Coin cells (CR2032) have small capacity; 20% is a reasonable warning.
 */
const BATTERY_THRESHOLDS: Partial<Record<DeviceCategory, BatteryThreshold>> = {
  lock:            { warn: 20, critical: 10, typicalBattery: 'CR123A / CR2 (Lithium)' },
  'door-sensor':   { warn: 20, critical: 10, typicalBattery: 'CR2 (Lithium)' },
  'motion-sensor': { warn: 15, critical:  5, typicalBattery: 'CR123A (Lithium)' },
  'leak-sensor':   { warn: 25, critical: 10, typicalBattery: 'AA (Alkaline)' },
  remote:          { warn: 20, critical: 10, typicalBattery: 'CR2032 (Coin Cell)' },
};

const DEFAULT_BATTERY_THRESHOLD: BatteryThreshold = {
  warn: 25,
  critical: 10,
  typicalBattery: 'Varies',
};

/** Get battery threshold for a device category */
export function getBatteryThreshold(category: DeviceCategory): BatteryThreshold {
  return BATTERY_THRESHOLDS[category] ?? DEFAULT_BATTERY_THRESHOLD;
}

/** Classify battery status given a level and category */
export function getBatteryStatus(
  level: number,
  category: DeviceCategory,
): 'good' | 'low' | 'critical' {
  const t = getBatteryThreshold(category);
  if (level <= t.critical) return 'critical';
  if (level <= t.warn) return 'low';
  return 'good';
}

// ─── Z-Wave Metadata Decoders ──────────────────────────────────

/**
 * Known Z-Wave manufacturer IDs → human-readable names.
 *
 * Source: Z-Wave Alliance manufacturer registry. Only the IDs observed on the
 * user's network are included; this table grows as more devices are encountered.
 * Format in ISY's devtype.mfg: "manufacturerId.productType.productId"
 */
const ZWAVE_MANUFACTURERS: Record<number, string> = {
  1:    'ACT — Advanced Control Technologies',
  2:    'Danfoss',
  5:    'FAKRO',
  24:   'Trane',
  44:   'GreenWave Reality',
  53:   'Wenzhou MTLC Electric',
  65:   'Z-Wave.Me',
  89:   'Honeywell',
  99:   'GE / Jasco',
  100:  'Nortek Security & Control',
  113:  'Evolve',
  129:  'Linear / GoControl',
  134:  'AEON Labs',
  138:  'Monoprice',
  174:  'Leviton',
  265:  'Ecolink',
  271:  'Fibaro',
  280:  'Inovelli',
  297:  'Yale',
  340:  'Ring',
  345:  'Kwikset',
  352:  'Zooz',
  374:  'Schlage',
  375:  'Qolsys',
  388:  'First Alert',
  486:  'Dome',
  881:  'Aeotec',
  634:  'Minoston',
};

/** Look up a Z-Wave manufacturer name by numeric ID. Returns null if unknown. */
export function getZWaveManufacturerName(mfgId: number): string | null {
  return ZWAVE_MANUFACTURERS[mfgId] ?? null;
}

// ─── Z-Wave Product Identification ────────────────────────────

/**
 * Z-Wave product identification — maps "manufacturerId.productType.productId"
 * triplets (from ISY's devtype.mfg field) to specific product models.
 *
 * Populated from the user's actual device inventory. Unknown products fall back
 * to manufacturer name + generic device class via `getZWaveProductName()`.
 *
 * The mfg field often encodes the model number: e.g., Aeotec's product ID 189
 * corresponds to their ZW189 (Range Extender 7).
 */
const ZWAVE_PRODUCTS: Record<string, { name: string; manufacturer: string; model: string }> = {
  // ─── Aeotec (881) ──────────────────────
  '881.260.189':    { name: 'Aeotec Range Extender 7',    manufacturer: 'Aeotec',  model: 'ZW189' },
  '881.2.100':      { name: 'Aeotec MultiSensor 6',       manufacturer: 'Aeotec',  model: 'ZW100' },
  '881.5.100':      { name: 'Aeotec MultiSensor 6',       manufacturer: 'Aeotec',  model: 'ZW100' },
  '881.2.89':       { name: 'Aeotec MultiSensor 7',       manufacturer: 'Aeotec',  model: 'ZW189' },
  '881.3.116':      { name: 'Aeotec Siren 6',             manufacturer: 'Aeotec',  model: 'ZW164' },
  '881.3.84':       { name: 'Aeotec Nano Dimmer',         manufacturer: 'Aeotec',  model: 'ZW111' },
  '881.3.96':       { name: 'Aeotec Nano Switch',         manufacturer: 'Aeotec',  model: 'ZW116' },
  // ─── Yale (297) ────────────────────────
  '297.32780.3840': { name: 'Yale YRD256 Assure Lock SL', manufacturer: 'Yale',    model: 'YRD256' },
  '297.3.1':        { name: 'Yale YRD226 Assure Lock',    manufacturer: 'Yale',    model: 'YRD226' },
  '297.6.1':        { name: 'Yale YRD446 Assure Lock 2',  manufacturer: 'Yale',    model: 'YRD446' },
  // ─── Kwikset (345) ────────────────────
  '345.1.1':        { name: 'Kwikset SmartCode 914',      manufacturer: 'Kwikset', model: '914' },
  '345.2.1':        { name: 'Kwikset SmartCode 916',      manufacturer: 'Kwikset', model: '916' },
  // ─── Schlage (374) ────────────────────
  '374.3.1':        { name: 'Schlage Connect BE469',      manufacturer: 'Schlage', model: 'BE469' },
  // ─── Zooz (352) ───────────────────────
  '352.514.4':      { name: 'Zooz ZEN26 On/Off Switch',   manufacturer: 'Zooz',    model: 'ZEN26' },
  '352.514.24':     { name: 'Zooz ZEN27 Dimmer Switch',   manufacturer: 'Zooz',    model: 'ZEN27' },
  '352.8193.8196':  { name: 'Zooz ZEN76 On/Off Switch',   manufacturer: 'Zooz',    model: 'ZEN76' },
  '352.8193.8200':  { name: 'Zooz ZEN77 Dimmer Switch',   manufacturer: 'Zooz',    model: 'ZEN77' },
  // ─── Inovelli (280) ──────────────────
  '280.258.1':      { name: 'Inovelli Red Series Dimmer',  manufacturer: 'Inovelli', model: 'LZW31-SN' },
  '280.259.1':      { name: 'Inovelli Red Series Switch',  manufacturer: 'Inovelli', model: 'LZW30-SN' },
  // ─── GE/Jasco (99) ───────────────────
  '99.18756.18756': { name: 'GE/Jasco Z-Wave Dimmer',     manufacturer: 'GE/Jasco', model: '14294' },
  '99.18756.18770': { name: 'GE/Jasco Z-Wave Switch',     manufacturer: 'GE/Jasco', model: '14291' },
  // ─── Ring (340) ───────────────────────
  '340.1.1':        { name: 'Ring Alarm Range Extender',   manufacturer: 'Ring',    model: '4AK1SZ-0EN0' },
  // ─── Ecolink (265) ───────────────────
  '265.2.1':        { name: 'Ecolink Door/Window Sensor',  manufacturer: 'Ecolink', model: 'DWZWAVE25' },
  '265.1.1':        { name: 'Ecolink Motion Sensor',       manufacturer: 'Ecolink', model: 'PIRZWAVE25' },
  // ─── Fibaro (271) ────────────────────
  '271.2048.4096':  { name: 'Fibaro Motion Sensor',        manufacturer: 'Fibaro',  model: 'FGMS-001' },
  '271.1536.4096':  { name: 'Fibaro Flood Sensor',         manufacturer: 'Fibaro',  model: 'FGFS-101' },
};

/**
 * Look up a Z-Wave product by its mfg field triplet (e.g., "881.260.189").
 * Returns null if the specific product/model is not in the database.
 */
export function getZWaveProduct(mfgField: string): { name: string; manufacturer: string; model: string } | null {
  return ZWAVE_PRODUCTS[mfgField] ?? null;
}

/**
 * Best-effort product name for a Z-Wave device.
 *
 * Resolution priority:
 * 1. Exact product match from ZWAVE_PRODUCTS (e.g., "Aeotec Range Extender 7")
 * 2. Manufacturer + Generic Device Class (e.g., "Aeotec Repeater Slave")
 * 3. Manufacturer only (e.g., "Aeotec Device")
 * 4. "Z-Wave Device" (no identifying data at all)
 */
export function getZWaveProductName(
  devtype?: { mfg?: string; gen?: string; cat?: number },
  nodeType?: string,
): string {
  if (!devtype?.mfg) {
    // No mfg data — try to get generic class from type field
    if (nodeType) {
      const match = nodeType.match(/^4\.(\d+)\./);
      if (match) {
        const generic = parseInt(match[1]!, 10);
        const className = getZWaveGenericClassName(generic);
        if (className) return `Z-Wave ${className}`;
      }
    }
    return 'Z-Wave Device';
  }

  const mfgField = String(devtype.mfg);

  // 1. Exact product match
  const product = getZWaveProduct(mfgField);
  if (product) return product.name;

  // 2. Manufacturer + generic class
  const parts = mfgField.split('.');
  const mfgId = parseInt(parts[0]!, 10);
  const mfgName = getZWaveManufacturerName(mfgId);

  if (nodeType) {
    const match = nodeType.match(/^4\.(\d+)\./);
    if (match) {
      const generic = parseInt(match[1]!, 10);
      const className = getZWaveGenericClassName(generic);
      if (className && mfgName) return `${mfgName} ${className}`;
      if (className) return `Z-Wave ${className}`;
    }
  }

  // 3. Manufacturer only
  if (mfgName) return `${mfgName} Device`;

  // 4. Fallback
  return 'Z-Wave Device';
}

/**
 * Z-Wave Generic Device Class names (standard, from the Z-Wave specification).
 *
 * These correspond to the "generic" field (2nd number) in the ISY type field:
 * "routing.generic.specific.version" — e.g., type "4.64.3.0" → generic 64 = Entry Control.
 */
const ZWAVE_GENERIC_CLASSES: Record<number, string> = {
  1:   'Remote Controller',
  2:   'Static Controller',
  3:   'AV Control Point',
  4:   'Display',
  7:   'Garage Door',
  8:   'Thermostat',
  9:   'Window Covering',
  15:  'Repeater Slave',
  16:  'Binary Switch',
  17:  'Multilevel Switch',
  18:  'Remote Switch',
  21:  'Binary Sensor',
  32:  'Binary Sensor',
  33:  'Sensor Notification',
  48:  'Binary Sensor',
  49:  'Multilevel Sensor',
  64:  'Entry Control',
  80:  'Semi-Interoperable',
  96:  'Alarm Sensor',
  113: 'Alarm Sensor (Notification)',
  161: 'Non-Interoperable',
  255: 'Non-Interoperable',
};

/** Get human-readable Z-Wave Generic Device Class name. */
export function getZWaveGenericClassName(genericClass: number): string | null {
  return ZWAVE_GENERIC_CLASSES[genericClass] ?? null;
}

/**
 * ISY Z-Wave device category number → human-readable label.
 *
 * These are the ISY's own numeric categories assigned to Z-Wave devices
 * in the `<devtype><cat>` field (NOT the same as Z-Wave Generic Device Class).
 */
const ISY_ZWAVE_CATEGORIES: Record<number, string> = {
  109: 'Door Lock',
  111: 'Door Lock',
  119: 'Thermostat',
  121: 'Sensor',
  123: 'Binary Switch',
  124: 'Multilevel Switch',
  125: 'Remote',
  127: 'Barrier Operator',
  129: 'Repeater',
  131: 'Siren',
  133: 'Power Strip',
  140: 'Garage Door',
  141: 'Sensor — Multilevel',
  142: 'Entry Sensor',
  143: 'Motion Sensor',
};

/** Get ISY Z-Wave device category label from the devtype.cat number. */
export function getIsyZWaveCategoryName(cat: number): string | null {
  return ISY_ZWAVE_CATEGORIES[cat] ?? null;
}

/**
 * Insteon Category names.
 *
 * The first number in the ISY type field for Insteon devices ("Category.SubCat.Firmware.Version")
 * corresponds to the Insteon device category.
 */
const INSTEON_CATEGORIES: Record<number, string> = {
  0: 'Generalized Controllers',
  1: 'Dimmable Lighting Control',
  2: 'Switched Lighting Control',
  3: 'Network Bridges',
  4: 'Irrigation Control',
  5: 'Climate Control',
  6: 'Pool and Spa Control',
  7: 'Sensors and Actuators',
  9: 'Energy Management',
  14: 'Window Coverings',
  15: 'Access Control',
  16: 'Security/Health/Safety',
};

/** Get Insteon category name from the category number (1st number in type field). */
export function getInsteonCategoryName(category: number): string | null {
  return INSTEON_CATEGORIES[category] ?? null;
}

/**
 * Decoded device metadata — a unified view of all available device information,
 * combining data from nodeDefId, type field, devtype, and other XML fields.
 */
export interface DecodedDeviceMetadata {
  /** Protocol family */
  protocol: 'Insteon' | 'Z-Wave' | 'Node Server' | 'Unknown';
  /** ISY type field raw value (e.g., "4.64.3.0") */
  typeFieldRaw?: string;
  /** Decoded description from type field (e.g., "Entry Control (Generic Class 64)") */
  typeFieldDecoded?: string;

  // ─── Z-Wave specific ──────────────────
  /** Z-Wave manufacturer name (from devtype.mfg) */
  manufacturer?: string;
  /** Z-Wave manufacturer ID (numeric) */
  manufacturerId?: number;
  /** Z-Wave product type (from devtype.mfg) */
  productType?: number;
  /** Z-Wave product ID (from devtype.mfg) */
  productId?: number;
  /** Z-Wave Generic Device Class (from type field) */
  zwaveGenericClass?: string;
  /** Z-Wave gen field decoded (from devtype.gen) */
  zwaveGenField?: string;
  /** ISY Z-Wave device category name (from devtype.cat) */
  isyCategory?: string;
  /** ISY Z-Wave device category number */
  isyCategoryNum?: number;
  /** Routing parent node address */
  routingParent?: string;
  /** Sub-group / endpoint ID */
  endpoint?: number;

  // ─── Insteon specific ─────────────────
  /** Insteon category name */
  insteonCategory?: string;
  /** Insteon category number */
  insteonCategoryNum?: number;
  /** Insteon sub-category number */
  insteonSubCategory?: number;
  /** Insteon firmware version */
  insteonFirmware?: number;
}

/**
 * Extract and decode all available device metadata from an IsyNode.
 *
 * Combines multiple ISY fields (type, devtype, rpnode, sgid, family) into a
 * unified, human-readable metadata object suitable for display.
 */
export function decodeDeviceMetadata(node: {
  address: string;
  type?: string;
  family?: number | { '@_instance'?: number; '#text': number };
  devtype?: { gen?: string; mfg?: string; cat?: number };
  rpnode?: string;
  sgid?: number;
  '@_nodeDefId'?: string;
}): DecodedDeviceMetadata {
  const address = String(node.address);
  const isZWave = /^Z[WYLR]\d/i.test(String(address));
  const isInsteon = /^[0-9A-Fa-f]{1,2}\s/.test(String(address));
  const isNodeServer = /^n\d{3}_/i.test(String(address));

  // Determine protocol from family field or address pattern
  let protocol: DecodedDeviceMetadata['protocol'] = 'Unknown';
  const familyNum = typeof node.family === 'object' ? node.family?.['#text'] : node.family;
  if (familyNum === 12 || isZWave) protocol = 'Z-Wave';
  else if (familyNum === 10 || isNodeServer) protocol = 'Node Server';
  else if (isInsteon || familyNum === undefined) protocol = 'Insteon';

  const meta: DecodedDeviceMetadata = { protocol };
  const nodeType = node.type ? String(node.type) : undefined;

  if (nodeType) {
    meta.typeFieldRaw = nodeType;
  }

  // ── Z-Wave decoding ────────────────────────────────────────
  if (protocol === 'Z-Wave' && nodeType) {
    const match = nodeType.match(/^4\.(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      const generic = parseInt(match[1]!, 10);
      const specific = parseInt(match[2]!, 10);
      const className = getZWaveGenericClassName(generic);
      meta.zwaveGenericClass = className
        ? `${className} (Generic ${generic}, Specific ${specific})`
        : `Generic ${generic}, Specific ${specific}`;
      meta.typeFieldDecoded = className ?? `Z-Wave Class ${generic}`;
    }
  }

  // ── devtype decoding (Z-Wave manufacturer/product info) ────
  if (node.devtype) {
    // Manufacturer info from mfg field: "manufacturerId.productType.productId"
    if (node.devtype.mfg) {
      const parts = String(node.devtype.mfg).split('.');
      if (parts.length >= 3) {
        const mfgId = parseInt(parts[0]!, 10);
        meta.manufacturerId = mfgId;
        meta.productType = parseInt(parts[1]!, 10);
        meta.productId = parseInt(parts[2]!, 10);
        const mfgName = getZWaveManufacturerName(mfgId);
        if (mfgName) meta.manufacturer = mfgName;
      }
    }
    // Gen field: "generic.specific.commandClass"
    if (node.devtype.gen) {
      meta.zwaveGenField = String(node.devtype.gen);
    }
    // ISY device category
    if (node.devtype.cat != null) {
      meta.isyCategoryNum = node.devtype.cat;
      const catName = getIsyZWaveCategoryName(node.devtype.cat);
      if (catName) meta.isyCategory = catName;
    }
  }

  // ── Z-Wave mesh info ───────────────────────────────────────
  if (node.rpnode) meta.routingParent = String(node.rpnode);
  if (node.sgid != null) meta.endpoint = node.sgid;

  // ── Insteon decoding ───────────────────────────────────────
  if (protocol === 'Insteon' && nodeType) {
    const match = nodeType.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      const cat = parseInt(match[1]!, 10);
      const subCat = parseInt(match[2]!, 10);
      const firmware = parseInt(match[3]!, 10);
      meta.insteonCategoryNum = cat;
      meta.insteonSubCategory = subCat;
      meta.insteonFirmware = firmware;
      const catName = getInsteonCategoryName(cat);
      if (catName) {
        meta.insteonCategory = catName;
        meta.typeFieldDecoded = `${catName} (Cat ${cat}, SubCat ${subCat})`;
      } else {
        meta.typeFieldDecoded = `Category ${cat}, SubCat ${subCat}`;
      }
    }
  }

  return meta;
}
