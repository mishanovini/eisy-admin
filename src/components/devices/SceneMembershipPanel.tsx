/**
 * Scene membership panel — shows which scenes a device belongs to.
 *
 * Matches UDAC's "Membership" panel: groups by "Is Controller for" and
 * "Is Responder to". Each scene entry is expandable to show the other
 * members in that scene.
 *
 * Uses the shared getSceneMembers() from scene-utils for consistent
 * member resolution across the app.
 */
import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Layers, Users, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useDeviceStore } from '@/stores/device-store.ts';
import { getSceneMembers } from '@/utils/scene-utils.ts';
import type { SceneMember } from '@/utils/scene-utils.ts';
import { getDeviceTypeInfo } from '@/utils/device-types.ts';
import { ICON_MAP } from '@/components/tree/icon-map.ts';
import type { IsyGroup } from '@/api/types.ts';

interface SceneMembershipPanelProps {
  address: string;
}

/** A scene that this device is a member of, with the device's role and co-members */
interface SceneMembership {
  scene: IsyGroup;
  role: 'controller' | 'responder';
  /** Other members of this scene (all members EXCEPT the current device) */
  coMembers: SceneMember[];
}

export function SceneMembershipPanel({ address }: SceneMembershipPanelProps) {
  const scenes = useDeviceStore((s) => s.scenes);
  const nodeMap = useDeviceStore((s) => s.nodeMap);
  const [expanded, setExpanded] = useState(true);

  // Compute all scenes this device is a member of
  const memberships = useMemo(() => {
    const result: SceneMembership[] = [];

    for (const scene of scenes) {
      if (!scene.members?.link) continue;

      const links = Array.isArray(scene.members.link)
        ? scene.members.link
        : [scene.members.link];

      // Find this device in the scene's links
      for (const link of links) {
        const linkAddr = String(link['#text']);
        if (linkAddr === address) {
          const role: 'controller' | 'responder' =
            link['@_type'] === 16 ? 'controller' : 'responder';

          // Get all members of this scene, excluding the current device
          const allMembers = getSceneMembers(scene, nodeMap);
          const coMembers = allMembers.filter((m) => m.address !== address);

          result.push({ scene, role, coMembers });
          break; // Device can only appear once per scene
        }
      }
    }

    // Sort: controller scenes first, then alphabetically
    result.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'controller' ? -1 : 1;
      return a.scene.name.localeCompare(b.scene.name);
    });

    return result;
  }, [scenes, nodeMap, address]);

  const controllerScenes = memberships.filter((m) => m.role === 'controller');
  const responderScenes = memberships.filter((m) => m.role === 'responder');

  if (memberships.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Scene Membership ({memberships.length})
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Is Controller for */}
          {controllerScenes.length > 0 && (
            <MembershipGroup
              title="Is Controller for"
              icon={Users}
              memberships={controllerScenes}
            />
          )}

          {/* Is Responder to */}
          {responderScenes.length > 0 && (
            <MembershipGroup
              title="Is Responder to"
              icon={Settings2}
              memberships={responderScenes}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Membership Group ────────────────────────────────────────

function MembershipGroup({
  title,
  icon: Icon,
  memberships,
}: {
  title: string;
  icon: LucideIcon;
  memberships: SceneMembership[];
}) {
  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
        <Icon size={12} />
        {title}
      </h4>
      <div className="space-y-0.5">
        {memberships.map((m) => (
          <SceneEntry key={m.scene.address} membership={m} />
        ))}
      </div>
    </div>
  );
}

// ─── Scene Entry (expandable) ────────────────────────────────

function SceneEntry({ membership }: { membership: SceneMembership }) {
  const [expanded, setExpanded] = useState(false);
  const { scene, coMembers } = membership;

  return (
    <div className="rounded-md border border-gray-100 dark:border-gray-800">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
      >
        <span className="flex-shrink-0 text-gray-400">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <Layers size={14} className="flex-shrink-0 text-purple-500" />
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-gray-100">
          {scene.name}
        </span>
        <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
          {coMembers.length} member{coMembers.length !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && coMembers.length > 0 && (
        <div className="border-t border-gray-100 px-2 py-1 dark:border-gray-800">
          {coMembers.map((member) => (
            <CoMemberRow key={member.address} member={member} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Co-Member Row ───────────────────────────────────────────

function CoMemberRow({ member }: { member: SceneMember }) {
  const typeInfo = getDeviceTypeInfo(member.nodeDefId, member.nodeType);
  const IconComponent = ICON_MAP[typeInfo.icon];

  return (
    <div className="flex items-center gap-2 py-0.5 pl-6 text-xs">
      <span className="flex-shrink-0">
        {IconComponent && (
          <IconComponent size={12} className="text-gray-400 dark:text-gray-500" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
        {member.name}
      </span>
      <span
        className={`flex-shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
          member.role === 'controller'
            ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
        }`}
      >
        {member.role === 'controller' ? 'ctrl' : 'resp'}
      </span>
    </div>
  );
}
