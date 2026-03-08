/**
 * Program membership panel — shows which programs reference a device.
 *
 * Scans D2D trigger data (program conditions and actions) for the device
 * address. Groups programs by role:
 *   - "Triggers" — device appears in the IF condition (e.g., motion sensor → turn on lights)
 *   - "Controlled by" — device appears in THEN/ELSE actions (e.g., program turns this light on)
 *
 * Also scans REST program summaries for simpler programs that may not have D2D data.
 */
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Code2 } from 'lucide-react';
import { useProgramStore } from '@/stores/program-store.ts';
import { boolAttr } from '@/utils/xml-parser.ts';

interface ProgramMembershipPanelProps {
  address: string;
}

interface ProgramReference {
  id: string;
  name: string;
  roles: Set<'trigger' | 'action'>;
  enabled: boolean;
}

export function ProgramMembershipPanel({ address }: ProgramMembershipPanelProps) {
  const triggers = useProgramStore((s) => s.triggers);
  const programs = useProgramStore((s) => s.programs);
  const [expanded, setExpanded] = useState(true);

  // Find all programs that reference this device address
  const references = useMemo(() => {
    const refMap = new Map<string, ProgramReference>();
    const addr = String(address);

    // Scan D2D triggers for the device address in IF/THEN/ELSE blocks
    for (const trigger of triggers) {
      const roles = new Set<'trigger' | 'action'>();
      const idStr = String(trigger.id);

      // Check IF condition — device is a trigger for this program
      if (trigger.if && containsAddress(trigger.if, addr)) {
        roles.add('trigger');
      }

      // Check THEN/ELSE actions — device is controlled by this program
      if (
        (trigger.then && containsAddress(trigger.then, addr)) ||
        (trigger.else && containsAddress(trigger.else, addr))
      ) {
        roles.add('action');
      }

      if (roles.size > 0) {
        // Find the REST program summary to get enabled status
        const programSummary = programs.find((p) => p['@_id'] === idStr);
        const enabled = programSummary ? boolAttr(programSummary['@_enabled']) : true;

        refMap.set(idStr, {
          id: idStr,
          name: trigger.name || `Program ${idStr}`,
          roles,
          enabled,
        });
      }
    }

    // Sort: triggers first, then alphabetical
    return Array.from(refMap.values()).sort((a, b) => {
      const aHasTrigger = a.roles.has('trigger');
      const bHasTrigger = b.roles.has('trigger');
      if (aHasTrigger !== bHasTrigger) return aHasTrigger ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [triggers, programs, address]);

  const triggerPrograms = references.filter((r) => r.roles.has('trigger'));
  const actionPrograms = references.filter((r) => r.roles.has('action'));

  if (references.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Program Membership ({references.length})
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Triggers programs (device in IF condition) */}
          {triggerPrograms.length > 0 && (
            <ProgramGroup
              title="Triggers"
              subtitle="device state triggers these programs"
              programs={triggerPrograms}
            />
          )}

          {/* Controlled by programs (device in THEN/ELSE) */}
          {actionPrograms.length > 0 && (
            <ProgramGroup
              title="Controlled by"
              subtitle="these programs send commands to this device"
              programs={actionPrograms}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Program Group ──────────────────────────────────────────

function ProgramGroup({
  title,
  subtitle,
  programs,
}: {
  title: string;
  subtitle: string;
  programs: ProgramReference[];
}) {
  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
        <Code2 size={12} />
        {title}
        <span className="font-normal text-gray-400 dark:text-gray-500">— {subtitle}</span>
      </h4>
      <div className="space-y-0.5">
        {programs.map((prog) => (
          <div
            key={prog.id}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              prog.enabled
                ? 'text-gray-900 dark:text-gray-100'
                : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            <Code2 size={14} className="flex-shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1 truncate">
              {prog.name}
            </span>
            {prog.roles.has('trigger') && prog.roles.has('action') && (
              <span className="flex-shrink-0 rounded bg-purple-50 px-1 py-0.5 text-[10px] font-medium text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                trigger + action
              </span>
            )}
            {!prog.enabled && (
              <span className="flex-shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                disabled
              </span>
            )}
            <span className="flex-shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
              {prog.id}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Check if a D2D XML block contains a device address.
 *
 * D2D blocks reference devices using their Insteon address (e.g., "28 A5 D8 1")
 * or Z-Wave address (e.g., "ZW007_1"). The address may appear in multiple formats:
 * - Direct: the address string as-is
 * - Insteon hex address with spaces converted: "28 A5 D8" → "28.A5.D8"
 *
 * We do a simple case-insensitive string search which catches all common formats.
 */
function containsAddress(d2dBlock: string, address: string): boolean {
  const block = d2dBlock.toLowerCase();
  const addr = address.toLowerCase();

  // Direct match
  if (block.includes(addr)) return true;

  // Try with dots replaced by spaces (Insteon addresses: "28 A5 D8" vs "28.A5.D8")
  const addrSpaces = addr.replace(/\./g, ' ');
  if (addrSpaces !== addr && block.includes(addrSpaces)) return true;

  // Try with spaces replaced by dots
  const addrDots = addr.replace(/ /g, '.');
  if (addrDots !== addr && block.includes(addrDots)) return true;

  return false;
}
