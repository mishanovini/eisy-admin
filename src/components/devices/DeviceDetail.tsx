/**
 * Full device detail panel — properties, formatted values, and controls.
 * Displayed in the right side of the Devices page when a node is selected.
 *
 * Shows all available device metadata, including Z-Wave manufacturer info,
 * device class, routing parent, and Insteon category/subcategory data.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useDevice } from '@/hooks/useDevice.ts';
import { useStatusStore } from '@/stores/status-store.ts';
import { useDeviceStore } from '@/stores/device-store.ts';
import { DeviceControls } from './DeviceControls.tsx';
import { DeviceConfig } from './DeviceConfig.tsx';
import { InsteonConfigPanel } from './InsteonConfigPanel.tsx';
import { SceneMembershipPanel } from './SceneMembershipPanel.tsx';
import { ICON_MAP } from '@/components/tree/icon-map.ts';
import { getProtocolFamily, formatAddress } from '@/utils/address.ts';
import { getModelName, getZWaveProductName, decodeDeviceMetadata } from '@/utils/device-types.ts';
import { boolAttr } from '@/utils/xml-parser.ts';

interface DeviceDetailProps {
  address: string;
}

/** A single row in the device info section */
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 py-0.5">
      <dt className="w-32 shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={`min-w-0 break-all text-gray-900 dark:text-gray-100 ${mono ? 'font-mono text-xs leading-5' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

export function DeviceDetail({ address }: DeviceDetailProps) {
  const device = useDevice(address);
  // Select raw Map entry directly — avoids calling store methods in selectors
  // which can cause useSyncExternalStore timing mismatches during rapid updates.
  const stProp = useStatusStore(
    (s) => s.properties.get(String(address))?.get('ST'),
  );
  const [showConfig, setShowConfig] = useState(false);

  if (!device) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">Device not found.</p>
      </div>
    );
  }

  const IconComponent = ICON_MAP[device.typeInfo.icon];
  const currentValue = stProp ? Number(stProp['@_value']) : 0;
  const protocolFamily = getProtocolFamily(device.address);
  const modelName = getModelName(device.nodeDefId);
  const displayAddress = formatAddress(device.address);

  // Product identification — specific product model for Z-Wave (e.g., "Aeotec Range Extender 7")
  // or Insteon model name (e.g., "SwitchLinc Dimmer 2477D")
  const zwaveProductName = protocolFamily === 'zwave'
    ? getZWaveProductName(device.rawNode.devtype, device.rawNode.type ? String(device.rawNode.type) : undefined)
    : null;
  const productName = zwaveProductName && zwaveProductName !== 'Z-Wave Device'
    ? zwaveProductName
    : modelName;

  // Decode all available metadata from the raw ISY node
  const meta = decodeDeviceMetadata(device.rawNode);

  // Resolve routing parent name (if applicable)
  const rpNodeName = meta.routingParent
    ? useDeviceStore.getState().getNode(meta.routingParent)?.name
    : undefined;

  // Determine enabled status
  const enabledRaw = device.rawNode.enabled;
  const isEnabled = enabledRaw !== undefined ? boolAttr(enabledRaw) : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
          {IconComponent && (
            <IconComponent size={24} className="text-gray-600 dark:text-gray-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {device.name}
          </h2>
          {productName && (
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
              {productName}
            </p>
          )}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {device.typeInfo.label} &middot; {meta.protocol} &middot;{' '}
            <span className="font-mono text-xs">{displayAddress}</span>
          </p>
        </div>
      </div>

      {/* Primary value */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Status
        </div>
        <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
          {device.primaryValue}
        </div>
      </div>

      {/* Controls */}
      {device.typeInfo.controls !== 'none' && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Controls
          </h3>
          <DeviceControls
            controlType={device.typeInfo.controls}
            currentValue={currentValue}
            onCommand={device.sendCommand}
            onRefresh={device.refresh}
          />
        </div>
      )}

      {/* Insteon Configuration — property dropdowns + extended commands */}
      {protocolFamily === 'insteon' && (
        <InsteonConfigPanel
          address={device.address}
          category={device.category}
          nodeDefId={device.nodeDefId}
          sendCommand={device.sendCommand}
          setProperty={device.setProperty}
          onRefresh={device.refresh}
        />
      )}

      {/* Properties table */}
      {device.properties.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Properties
          </h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Property
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Value
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">
                    Raw
                  </th>
                </tr>
              </thead>
              <tbody>
                {device.properties.map((prop) => (
                  <tr
                    key={prop.id}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                  >
                    <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">
                      {prop.name}
                    </td>
                    <td className="px-3 py-1.5 text-gray-900 dark:text-gray-100">
                      {prop.value}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-400 dark:text-gray-500">
                      {String(prop.raw['@_value'])}
                      {prop.raw['@_uom'] ? ` (UOM ${prop.raw['@_uom']})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Device Info — comprehensive metadata section */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Device Info
        </h3>
        <dl className="space-y-0.5 text-sm">
          {/* ── Common fields (all protocols) ── */}
          <InfoRow label="Address" value={displayAddress} mono />
          <InfoRow label="Protocol" value={meta.protocol} />
          <InfoRow label="Category" value={device.typeInfo.label} />

          {device.nodeDefId && (
            <InfoRow label="Node Def ID" value={device.nodeDefId} mono />
          )}
          {productName && (
            <InfoRow label="Product" value={productName} />
          )}
          {isEnabled !== undefined && (
            <InfoRow label="Enabled" value={isEnabled ? 'Yes' : 'No'} />
          )}
          {device.rawNode.pnode && (
            <InfoRow label="Parent Node" value={String(device.rawNode.pnode)} mono />
          )}

          {/* ── ISY Type Field (decoded) ── */}
          {meta.typeFieldDecoded && (
            <InfoRow label="Device Class" value={meta.typeFieldDecoded} />
          )}
          {meta.typeFieldRaw && (
            <InfoRow label="Type Code" value={meta.typeFieldRaw} mono />
          )}

          {/* ── Z-Wave specific ── */}
          {meta.manufacturer && (
            <InfoRow label="Manufacturer" value={meta.manufacturer} />
          )}
          {meta.manufacturerId != null && (
            <InfoRow
              label="Mfg / Product"
              value={`${meta.manufacturerId} / ${meta.productType ?? '—'} / ${meta.productId ?? '—'}`}
              mono
            />
          )}
          {meta.zwaveGenericClass && (
            <InfoRow label="Z-Wave Class" value={meta.zwaveGenericClass} />
          )}
          {meta.zwaveGenField && (
            <InfoRow label="Gen Field" value={meta.zwaveGenField} mono />
          )}
          {meta.isyCategory && (
            <InfoRow label="ISY Category" value={`${meta.isyCategory} (${meta.isyCategoryNum})`} />
          )}
          {meta.routingParent && (
            <InfoRow
              label="Routing Parent"
              value={rpNodeName ? `${rpNodeName} (${meta.routingParent})` : meta.routingParent}
            />
          )}
          {meta.endpoint != null && (
            <InfoRow label="Endpoint" value={String(meta.endpoint)} mono />
          )}

          {/* ── Insteon specific ── */}
          {meta.insteonCategory && (
            <InfoRow
              label="Insteon Class"
              value={`${meta.insteonCategory} (Cat ${meta.insteonCategoryNum})`}
            />
          )}
          {meta.insteonSubCategory != null && (
            <InfoRow label="SubCategory" value={String(meta.insteonSubCategory)} mono />
          )}
          {meta.insteonFirmware != null && (
            <InfoRow label="Firmware" value={String(meta.insteonFirmware)} mono />
          )}

          {/* ── Timing fields ── */}
          {device.rawNode.dcPeriod != null && device.rawNode.dcPeriod > 0 && (
            <InfoRow label="DC Period" value={`${device.rawNode.dcPeriod}s`} />
          )}

          {/* ── Battery ── */}
          {device.typeInfo.hasBattery && (
            <InfoRow
              label="Battery"
              value={device.properties.find((p) => p.id === 'BATLVL')?.value ?? 'Unknown'}
            />
          )}
        </dl>
      </div>

      {/* Scene Membership — shows which scenes this device belongs to */}
      <SceneMembershipPanel address={device.address} />

      {/* Configuration parameters (Z-Wave devices) */}
      {protocolFamily === 'zwave' && device.nodeDefId && (
        <div>
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {showConfig ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Configuration
          </button>
          {showConfig && (
            <DeviceConfig address={device.address} nodeDefId={device.nodeDefId} />
          )}
        </div>
      )}
    </div>
  );
}
