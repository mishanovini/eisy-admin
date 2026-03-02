/**
 * Add Spoken Entry modal — 3-step device picker for creating new voice entries.
 *
 * Step 1: Pick a category (Standard Device, Scene, Program, Lock)
 * Step 2: Search and select a device from the filtered list
 * Step 3: Configure spoken names, room, and Google Home type
 *
 * Follows the ConfirmDialog overlay pattern (fixed + backdrop + Escape key).
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  X,
  Search,
  Lightbulb,
  Layers,
  Code2,
  Lock,
  ChevronLeft,
  Loader2,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { useProgramStore } from '@/stores/program-store.ts';
import { usePortalStore } from '@/stores/portal-store.ts';
import type { SpokenNodePayload } from '@/stores/portal-store.ts';
import { getDeviceCategory, getDeviceTypeInfo } from '@/utils/device-types.ts';
import { boolAttr } from '@/utils/xml-parser.ts';

// ─── Types ──────────────────────────────────────────────────

type Category = 'std' | 'scene' | 'program' | 'lock';
type Step = 1 | 2 | 3;

interface DeviceOption {
  address: string;
  name: string;
  typeLabel: string;
  /** Used for auto-suggesting userCat */
  deviceCategory: string;
}

// ─── Category → userCat auto-suggestion ─────────────────────

function suggestUserCat(portalCategory: Category, deviceCategory?: string): string {
  if (portalCategory === 'scene') return 'scene';
  if (portalCategory === 'lock') return 'lock';
  if (portalCategory === 'program') return 'switch';

  // Standard device — infer from device category
  if (deviceCategory) {
    const map: Record<string, string> = {
      dimmer: 'light',
      switch: 'switch',
      fan: 'fan',
      lock: 'lock',
      outlet: 'outlet',
      'door-sensor': 'openClose',
      'garage-door': 'openClose',
      scene: 'scene',
    };
    if (map[deviceCategory]) return map[deviceCategory];
  }
  return 'light'; // default
}

// ─── Constants ──────────────────────────────────────────────

const USER_CAT_OPTIONS: { value: string; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'switch', label: 'Switch' },
  { value: 'outlet', label: 'Outlet' },
  { value: 'fan', label: 'Fan' },
  { value: 'lock', label: 'Lock' },
  { value: 'scene', label: 'Scene' },
  { value: 'openClose', label: 'Open/Close' },
];

const CATEGORY_CARDS: { id: Category; label: string; icon: typeof Lightbulb; description: string }[] = [
  { id: 'std', label: 'Standard Device', icon: Lightbulb, description: 'Lights, switches, outlets, fans, sensors' },
  { id: 'scene', label: 'Scene', icon: Layers, description: 'Insteon scenes / Z-Wave groups' },
  { id: 'program', label: 'Program', icon: Code2, description: 'ISY programs to run/stop' },
  { id: 'lock', label: 'Lock', icon: Lock, description: 'Door locks and entry controls' },
];

// ─── Component ──────────────────────────────────────────────

export function AddSpokenModal({ onClose }: { onClose: () => void }) {
  const nodes = useDeviceStore((s) => s.nodes);
  const scenes = useDeviceStore((s) => s.scenes);
  const programs = useProgramStore((s) => s.programs);
  const rooms = usePortalStore((s) => s.rooms);
  const credentials = usePortalStore((s) => s.credentials);
  const createSpoken = usePortalStore((s) => s.createSpoken);

  const [step, setStep] = useState<Step>(1);
  const [category, setCategory] = useState<Category>('std');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DeviceOption | null>(null);

  // Step 3 form state
  const [spoken, setSpoken] = useState<string[]>(['', '', '', '', '']);
  const [room, setRoom] = useState('');
  const [userCat, setUserCat] = useState('light');
  const [saving, setSaving] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null!);

  const backdropRef = useRef<HTMLDivElement>(null);

  // ── Build device lists per category ──
  const deviceLists = useMemo(() => {
    const std: DeviceOption[] = [];
    const locks: DeviceOption[] = [];

    for (const n of nodes) {
      const cat = getDeviceCategory(n['@_nodeDefId'], n.type ? String(n.type) : undefined);
      const info = getDeviceTypeInfo(n['@_nodeDefId'], n.type ? String(n.type) : undefined);
      const opt: DeviceOption = {
        address: String(n.address),
        name: n.name,
        typeLabel: info.label,
        deviceCategory: cat,
      };
      if (cat === 'lock') {
        locks.push(opt);
      }
      // All devices can be added as standard (locks too — user might want voice "lock backyard")
      std.push(opt);
    }

    const sceneList: DeviceOption[] = scenes.map((s) => ({
      address: String(s.address),
      name: s.name,
      typeLabel: 'Scene',
      deviceCategory: 'scene',
    }));

    const programList: DeviceOption[] = programs
      .filter((p) => !boolAttr(p['@_folder']))
      .map((p) => ({
        address: String(p['@_id']),
        name: p.name,
        typeLabel: boolAttr(p['@_enabled']) ? 'Enabled' : 'Disabled',
        deviceCategory: 'program',
      }));

    return { std, scene: sceneList, program: programList, lock: locks };
  }, [nodes, scenes, programs]);

  // Category counts for step 1 cards
  const counts: Record<Category, number> = {
    std: deviceLists.std.length,
    scene: deviceLists.scene.length,
    program: deviceLists.program.length,
    lock: deviceLists.lock.length,
  };

  // ── Filtered + sorted list for step 2 ──
  const filteredDevices = useMemo(() => {
    const list = deviceLists[category] ?? [];
    const q = search.toLowerCase().trim();
    const filtered = q
      ? list.filter(
          (d) =>
            d.name.toLowerCase().includes(q) ||
            d.address.toLowerCase().includes(q) ||
            d.typeLabel.toLowerCase().includes(q),
        )
      : list;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [deviceLists, category, search]);

  // ── Focus search when entering step 2 ──
  useEffect(() => {
    if (step === 2) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [step]);

  // ── Escape key handler ──
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // ── Step handlers ──
  const selectCategory = (cat: Category) => {
    setCategory(cat);
    setSearch('');
    setSelected(null);
    setStep(2);
  };

  const selectDevice = (device: DeviceOption) => {
    setSelected(device);
    // Auto-fill spoken name from device name (lowercased)
    setSpoken([device.name.toLowerCase(), '', '', '', '']);
    // Auto-suggest userCat
    setUserCat(suggestUserCat(category, device.deviceCategory));
    setStep(3);
  };

  const goBack = () => {
    if (step === 3) {
      setStep(2);
    } else if (step === 2) {
      setSearch('');
      setStep(1);
    }
  };

  // ── Submit ──
  const handleSubmit = async () => {
    if (!credentials || !selected || !spoken[0]) return;
    setSaving(true);

    const payload: SpokenNodePayload = {
      address: selected.address,
      spoken: spoken[0],
      spoken2: spoken[1] || undefined,
      spoken3: spoken[2] || undefined,
      spoken4: spoken[3] || undefined,
      spoken5: spoken[4] || undefined,
      room: room || undefined,
      category,
      userCat,
      uuid: credentials.uuid,
      domain: credentials.domain,
    };

    await createSpoken(payload);
    setSaving(false);
    onClose();
  };

  // ── Step title ──
  const stepTitle =
    step === 1
      ? 'Select Category'
      : step === 2
        ? `Pick ${category === 'program' ? 'a Program' : category === 'scene' ? 'a Scene' : 'a Device'}`
        : 'Configure Entry';

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5 dark:border-gray-700">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                onClick={goBack}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                title="Back"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Add Spoken Entry
              </h3>
              <p className="text-xs text-gray-400">
                Step {step} of 3 — {stepTitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 px-5 pt-3">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="p-5">
          {step === 1 && (
            <StepCategory counts={counts} onSelect={selectCategory} />
          )}
          {step === 2 && (
            <StepDevicePicker
              devices={filteredDevices}
              search={search}
              onSearchChange={setSearch}
              onSelect={selectDevice}
              searchRef={searchRef}
              category={category}
              totalCount={deviceLists[category]?.length ?? 0}
            />
          )}
          {step === 3 && selected && (
            <StepConfigure
              selected={selected}
              category={category}
              spoken={spoken}
              room={room}
              userCat={userCat}
              rooms={rooms}
              saving={saving}
              onSpokenChange={(idx, val) => {
                setSpoken((prev) => {
                  const next = [...prev];
                  next[idx] = val;
                  return next;
                });
              }}
              onRoomChange={setRoom}
              onUserCatChange={setUserCat}
              onSubmit={handleSubmit}
              onChangeDevice={goBack}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Category Selection ─────────────────────────────

function StepCategory({
  counts,
  onSelect,
}: {
  counts: Record<Category, number>;
  onSelect: (cat: Category) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CATEGORY_CARDS.map((card) => {
        const Icon = card.icon;
        const count = counts[card.id];
        return (
          <button
            key={card.id}
            onClick={() => onSelect(card.id)}
            disabled={count === 0}
            className="group flex flex-col items-center gap-2 rounded-xl border border-gray-200 p-4 text-center transition-all hover:border-blue-300 hover:bg-blue-50/50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:border-blue-700 dark:hover:bg-blue-900/10"
          >
            <div className="rounded-lg bg-gray-100 p-2.5 transition-colors group-hover:bg-blue-100 dark:bg-gray-800 dark:group-hover:bg-blue-900/30">
              <Icon size={20} className="text-gray-500 group-hover:text-blue-600 dark:text-gray-400" />
            </div>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{card.label}</span>
            <span className="text-xs text-gray-400">{count} available</span>
            <p className="text-[10px] leading-tight text-gray-400">{card.description}</p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Step 2: Device Picker ──────────────────────────────────

function StepDevicePicker({
  devices,
  search,
  onSearchChange,
  onSelect,
  searchRef,
  category,
  totalCount,
}: {
  devices: DeviceOption[];
  search: string;
  onSearchChange: (val: string) => void;
  onSelect: (device: DeviceOption) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  category: Category;
  totalCount: number;
}) {
  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={`Search ${totalCount} ${category === 'program' ? 'programs' : category === 'scene' ? 'scenes' : 'devices'}...`}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Count */}
      <p className="text-xs text-gray-400">
        {devices.length} {search ? 'matching' : 'total'}
        {search && ` of ${totalCount}`}
      </p>

      {/* Scrollable device list */}
      <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
        {devices.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {search ? 'No matches found' : 'No devices in this category'}
          </p>
        ) : (
          devices.map((device) => (
            <button
              key={device.address}
              onClick={() => onSelect(device)}
              className="flex w-full items-center justify-between border-b border-gray-100 px-3.5 py-2.5 text-left transition-colors last:border-0 hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-blue-900/10"
            >
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                  {device.name}
                </span>
                <span className="text-xs text-gray-400">{device.typeLabel}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {device.address}
                </span>
                <ArrowRight size={12} className="text-gray-300" />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Step 3: Configure Entry ────────────────────────────────

function StepConfigure({
  selected,
  category: _category,
  spoken,
  room,
  userCat,
  rooms,
  saving,
  onSpokenChange,
  onRoomChange,
  onUserCatChange,
  onSubmit,
  onChangeDevice,
}: {
  selected: DeviceOption;
  category: Category;
  spoken: string[];
  room: string;
  userCat: string;
  rooms: { _id: string; name: string }[];
  saving: boolean;
  onSpokenChange: (idx: number, val: string) => void;
  onRoomChange: (room: string) => void;
  onUserCatChange: (cat: string) => void;
  onSubmit: () => void;
  onChangeDevice: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Selected device summary */}
      <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3.5 py-2.5 dark:bg-gray-800">
        <div>
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {selected.name}
          </span>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>{selected.typeLabel}</span>
            <span className="font-mono">{selected.address}</span>
          </div>
        </div>
        <button
          onClick={onChangeDevice}
          className="text-xs text-blue-500 hover:text-blue-600"
        >
          Change
        </button>
      </div>

      {/* Spoken names */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Spoken Names
        </label>
        <div className="space-y-1.5">
          {Array.from({ length: 5 }, (_, i) => (
            <input
              key={i}
              type="text"
              value={spoken[i] ?? ''}
              onChange={(e) => onSpokenChange(i, e.target.value)}
              placeholder={i === 0 ? 'Primary spoken name (required)' : `Alternate name ${i + 1}`}
              className={`w-full rounded border px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-gray-100 ${
                i === 0
                  ? 'border-gray-300 dark:border-gray-600'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Room + Google Home Type */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Room
          </label>
          <select
            value={room}
            onChange={(e) => onRoomChange(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">No Room</option>
            {rooms.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Google Home Type
          </label>
          <select
            value={userCat}
            onChange={(e) => onUserCatChange(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {USER_CAT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={saving || !spoken[0]}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Creating...
            </>
          ) : (
            <>
              <Plus size={14} /> Add Entry
            </>
          )}
        </button>
      </div>
    </div>
  );
}
