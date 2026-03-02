/**
 * Device data + controls hook.
 * Combines device info from device-store with real-time status from status-store.
 */
import { useDeviceStore } from '@/stores/device-store.ts';
import { useStatusStore, type NodeProperties } from '@/stores/status-store.ts';
import { useLogStore } from '@/stores/log-store.ts';
import { sendNodeCommand, setNodeProperty, queryNode } from '@/api/rest.ts';
import { getDeviceCategory, getDeviceTypeInfo } from '@/utils/device-types.ts';
import { getProtocolFamily } from '@/utils/address.ts';
import { CMD } from '@/api/types.ts';
import { formatPropertyValue, formatPropertyName } from '@/utils/labels.ts';
import type { IsyNode, IsyProperty } from '@/api/types.ts';

/** Stable empty Map — avoids creating new references in selectors. */
const EMPTY_PROPS: NodeProperties = new Map();

/** Translate raw ISY command codes into human-readable action descriptions. */
function humanizeCommand(command: string, value: number | undefined, category: string): string {
  switch (command) {
    case CMD.DON:
    case 'DFON': {
      if (value === undefined || value === 255) return 'Turn On';
      const pct = Math.round((value / 255) * 100);
      return category === 'dimmer' ? `Dim to ${pct}%` : `Turn On (${pct}%)`;
    }
    case CMD.DOF:
    case 'DFOF':
      return 'Turn Off';
    case CMD.LOCK:
      return 'Lock';
    case CMD.UNLOCK:
      return 'Unlock';
    case 'BRT':
      return 'Brighten';
    case 'DIM':
      return 'Dim';
    case 'QUERY':
      return 'Query Status';
    case 'BEEP':
      return 'Beep';
    case 'FDUP':
      return 'Fan Speed Up';
    case 'FDDOWN':
      return 'Fan Speed Down';
    case 'FDSTOP':
      return 'Fan Stop';
    default:
      return value !== undefined ? `${command} ${value}` : command;
  }
}

export interface DeviceProperty {
  id: string;
  name: string;
  value: string;
  raw: IsyProperty;
}

export interface UseDeviceResult {
  name: string;
  address: string;
  nodeDefId?: string;
  category: ReturnType<typeof getDeviceCategory>;
  typeInfo: ReturnType<typeof getDeviceTypeInfo>;
  protocolFamily: 'insteon' | 'zwave' | 'nodeserver' | 'unknown';
  properties: DeviceProperty[];
  primaryValue: string;
  /** Raw ISY node data — contains all XML fields for metadata display */
  rawNode: IsyNode;
  /** Send a command to this device (DON, DOF, LOCK, etc.) */
  sendCommand: (command: string, value?: number) => Promise<boolean>;
  /** Set a device property (OL, RR, BL, etc.) */
  setProperty: (propId: string, value: number) => Promise<boolean>;
  /** Force a status refresh */
  refresh: () => Promise<boolean>;
}

/** Hook to access a device's data, status, and controls */
export function useDevice(address: string): UseDeviceResult | null {
  const node = useDeviceStore((s) => s.getNode(address));
  // Select the raw Map entry directly — do NOT call store methods inside selectors.
  // Store methods call get() internally which can create timing mismatches with
  // useSyncExternalStore during rapid WebSocket updates → infinite re-render loops.
  const nodeProps = useStatusStore(
    (s) => s.properties.get(String(address)) ?? EMPTY_PROPS,
  );
  const addLogEntry = useLogStore((s) => s.addEntry);

  if (!node) return null;

  const nodeDefId = node['@_nodeDefId'];
  const nodeType = node.type ? String(node.type) : undefined;
  const category = getDeviceCategory(nodeDefId, nodeType);
  const typeInfo = getDeviceTypeInfo(nodeDefId, nodeType);
  const protocolFamily = getProtocolFamily(address);

  // Build formatted property list, filtering out properties that don't apply
  // to this device type (e.g., RR for relays/switches which switch instantly)
  const properties: DeviceProperty[] = [];
  for (const [id, prop] of nodeProps) {
    // Ramp Rate is meaningless for relay/switch/outlet devices — they don't ramp
    if (id === 'RR' && (category === 'relay' || category === 'switch' || category === 'outlet')) {
      continue;
    }
    properties.push({
      id,
      name: formatPropertyName(id),
      value: formatPropertyValue(prop, category),
      raw: prop,
    });
  }

  // Primary display value (ST property)
  const stProp = nodeProps.get('ST');
  const primaryValue = stProp ? formatPropertyValue(stProp, category) : 'Unknown';

  const sendCommand = async (command: string, value?: number): Promise<boolean> => {
    const ok = await sendNodeCommand(address, command, value);

    // Optimistic status update — immediately reflect the change in the UI
    // without waiting for the WebSocket round-trip.
    if (ok) {
      const { updateProperty } = useStatusStore.getState();
      if (command === CMD.DON || command === CMD.DFON) {
        const stValue = value ?? 255;
        const pct = Math.round((stValue / 255) * 100);
        updateProperty(address, {
          '@_id': 'ST',
          '@_value': stValue,
          '@_formatted': `${pct}%`,
          '@_uom': '100',
        });
      } else if (command === CMD.DOF || command === CMD.DFOF) {
        updateProperty(address, {
          '@_id': 'ST',
          '@_value': 0,
          '@_formatted': 'Off',
          '@_uom': '100',
        });
      } else if (command === CMD.LOCK) {
        updateProperty(address, {
          '@_id': 'ST',
          '@_value': 100,
          '@_formatted': 'Locked',
          '@_uom': '11',
        });
      } else if (command === CMD.UNLOCK) {
        updateProperty(address, {
          '@_id': 'ST',
          '@_value': 0,
          '@_formatted': 'Unlocked',
          '@_uom': '11',
        });
      }
    }

    await addLogEntry({
      category: 'command',
      device: address,
      deviceName: node.name,
      action: humanizeCommand(command, value, category),
      source: 'manual',
      result: ok ? 'success' : 'fail',
      rawCommand: `/rest/nodes/${address}/cmd/${command}${value !== undefined ? `/${value}` : ''}`,
    });
    return ok;
  };

  const setProperty = async (propId: string, value: number): Promise<boolean> => {
    const ok = await setNodeProperty(address, propId, value);
    await addLogEntry({
      category: 'command',
      device: address,
      deviceName: node.name,
      action: `Set ${propId} = ${value}`,
      source: 'manual',
      result: ok ? 'success' : 'fail',
      rawCommand: `/rest/nodes/${address}/set/${propId}/${value}`,
    });
    return ok;
  };

  const refresh = async (): Promise<boolean> => {
    return queryNode(address);
  };

  return {
    name: node.name,
    address,
    nodeDefId,
    category,
    typeInfo,
    protocolFamily,
    properties,
    primaryValue,
    rawNode: node,
    sendCommand,
    setProperty,
    refresh,
  };
}
