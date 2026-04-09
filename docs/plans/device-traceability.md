# Plan: Device Action Traceability
Status: ACTIVE

## Context
Super eisy users need to answer "what turned on this light?" at a glance. Currently, all device state changes from WebSocket (DON/DOF) are logged with `source: 'device'` — no causality. 

**Key discovery**: The eisy's `/rest/log` entries include a **UID field** that identifies the cause:
- UID 0 = SYSTEM_USER (system/firmware)
- UID 1 = SYSTEM_DRIVER_USER (driver)
- UID 2 = WEB_USER (manual from admin console / REST API)
- UID 3 = SCHEDULER_USER (scheduled program trigger)
- UID 4 = D2D_USER (device-to-device / program action)
- UID 5 = ELK_USER (Elk alarm panel)

This UID field is already in the raw log data but we're not parsing it. No temporal correlation guessing needed — the eisy literally tells us.

**Other findings**:
- No program history API — only `lastRunTime`/`lastFinishTime` (most recent). Must accumulate from WebSocket.
- No log filtering on `/rest/log` — dumps entire buffer. Client-side filtering required.
- `@_status` on programs IS the IF condition evaluation state (true/false).
- Program humanizer exists in ProgramDetail.tsx but is buried in a React component.

## Goal
A user looks at a device and immediately sees: "Turned on at 6:30 PM by Program: Dusk Lights". Searchable, filterable, accessible to AI. A single place for traceability.

## Scope
- IN: UID-based source attribution, device history panel, program humanizer extraction, AI tools, log query utility
- OUT: New REST/SOAP endpoints, eisy firmware changes, program editor changes

## Tasks

### Phase 1: Parse UID for Source Attribution

- [ ] 1. Update `src/stores/eisy-log-store.ts` `parseLine()` function:
  - The Insteon format regex at line 303 captures `<addr> <control> <value> <day> <date> <time>` but ignores trailing fields
  - Extend regex to also capture the UID field (2nd-to-last number after timestamp)
  - Map UID to source string: `{0: 'system', 2: 'web-user', 3: 'scheduler', 4: 'program', 5: 'elk'}`
  - Return `uid` in the `ParsedLine` result
  - Same for Z-Wave format regex at line 277

- [ ] 2. Update WebSocket DON/DOF logging in `src/api/websocket.ts` (lines 192-207):
  - The WebSocket XML events may include a `<sid>` or `<s>` element indicating source
  - If available, use it. If not, we enhance attribution in Phase 1A below.

- [ ] 3. Create `src/utils/source-attribution.ts`:
  - `resolveSourceName(source: string): string` — converts source strings to display names:
    - `'program:001C'` → look up program name → "Program: Dusk Lights"
    - `'scene:5A 3C 21'` → look up scene name → "Scene: Evening Lights"
    - `'manual'` → "Manual (Super eisy)"
    - `'web-user'` → "Manual (Admin Console)"
    - `'scheduler'` → "Scheduled trigger"
    - `'program'` → "Program" (generic, when we know it was a program but not which one)
    - `'ai-chat'` → "AI Assistant"
    - `'portal'` → "Voice / Portal"
    - `'device'` → "Physical switch / remote"
    - `'system'` → "System"
  - For temporal correlation fallback (when UID isn't available from WebSocket):
    - Maintain a buffer of recently-running programs with their target devices
    - `registerProgramExecution(programId, clause)` — called on program `'running THEN'`/`'running ELSE'` events
    - `attributeSource(deviceAddress): string` — checks buffer for matching program, returns `'program:{id}'` or `'device'`
    - Buffer entries expire after 5 seconds

- [ ] 4. Wire temporal attribution into WebSocket handler:
  - On program event `'running THEN'`/`'running ELSE'`: call `registerProgramExecution()`
  - On DON/DOF event: replace `source: 'device'` with `attributeSource(node)`
  - When source is attributed to a program, also set `detail` to include program name for richer logging

### Phase 2: Extract Humanizer to Shared Utility

- [ ] 5. Create `src/utils/program-humanizer.ts` — extract from `ProgramDetail.tsx`:
  - All humanizer functions, constants, types (see previous plan version for full list)
  - Keep `ProgramBlock` React component in ProgramDetail.tsx

- [ ] 6. Update `ProgramDetail.tsx` imports. Visually verify Programs page.

### Phase 3: Device History Panel

- [ ] 7. Add standalone `queryLogs()` to `src/stores/log-store.ts`:
  - `export async function queryLogs(opts): Promise<LogEntry[]>` — cursor-based, no React state
  - Supports filtering by: `device`, `category`, `limit`, `since`

- [ ] 8. Create `src/components/devices/DeviceHistoryPanel.tsx`:
  - Shows recent events for the selected device
  - Each entry: relative time, action, **attributed source name** (via `resolveSourceName()`)
  - Source rendered with contextual icon/color (program = blue, manual = gray, AI = purple, etc.)
  - "No recent activity" empty state
  - Default 20 entries, compact design
  - Refresh button to re-query

- [ ] 9. Add `DeviceHistoryPanel` to `DeviceDetail.tsx` below properties section.

### Phase 4: AI Traceability Tools

- [ ] 10. Add `get_program_logic` tool to `src/ai/tools.ts`:
  - Resolves program → D2D trigger → humanized IF/THEN/ELSE text
  - Includes: name, enabled, `@_status` (IF condition state), lastRunTime, lastFinishTime, comment

- [ ] 11. Add `get_recent_events` tool:
  - Queries IndexedDB via `queryLogs()` for device/program history
  - Also queries eisy `/rest/log` buffer for very recent events (within last few minutes)
  - Returns formatted history with attributed sources

- [ ] 12. Add `find_programs_for_device` tool:
  - Scans D2D triggers for device address in IF/THEN/ELSE XML
  - Returns programs list with context (condition vs action)

- [ ] 13. Register all tools in `getToolDefinitions()` + `executeTool()`.

### Phase 5: Verification Pipeline
- [ ] 14. Write `pipeline/evidence.md`
- [ ] 15. Mechanical gates + code-reviewer PASS

## Files to Create/Modify

| File | Change | Risk |
|------|--------|------|
| `src/stores/eisy-log-store.ts` | Parse UID field from log entries | Medium — regex change, must not break existing parsing |
| `src/utils/source-attribution.ts` | NEW: source name resolution + temporal correlation buffer | Low — pure functions + simple buffer |
| `src/utils/program-humanizer.ts` | NEW: extracted humanizer functions | Low — pure functions |
| `src/components/devices/DeviceHistoryPanel.tsx` | NEW: device event history UI | Medium — new component |
| `src/api/websocket.ts` | Wire attribution into DON/DOF logging | High — core event flow |
| `src/components/programs/ProgramDetail.tsx` | Import refactor | Low |
| `src/components/devices/DeviceDetail.tsx` | Add DeviceHistoryPanel | Low — additive |
| `src/stores/log-store.ts` | Add `queryLogs()` export | Low — additive |
| `src/ai/tools.ts` | Add 3 tools + handlers | Medium |

## Key Implementation Details

**UID Parsing**: Insteon log format: `<addr> <ctrl> <value> <day> <date> <time> <type> <level>`. The `<type>` field appears to encode the UID. Need to verify exact position by examining raw eisy log output.

**Dual Attribution Strategy**: 
1. **Primary**: Parse UID from `/rest/log` entries → exact source
2. **Fallback**: Temporal correlation from WebSocket events → inferred source (program just ran + device it controls changed = likely that program)

**AI `/rest/log` Access**: The AI tool can call the existing `fetchEventLog()` function to get the raw eisy buffer, then parse/filter client-side. For longer history, query IndexedDB via `queryLogs()`.

**Program IF Status**: `@_status: 'true'` means IF condition was last TRUE. Display as "Condition: TRUE (last ran THEN)" or "Condition: FALSE (last ran ELSE)" in the AI tool output.

## Testing Strategy
1. **Phase 1**: Check eisy `/rest/log` output, verify UID parsing is correct
2. **Phase 1**: Turn on a light via program, verify log shows `source: 'program:XXXX'`
3. **Phase 2**: Programs page still renders IF/THEN/ELSE after import refactor
4. **Phase 3**: Select device → history panel shows events with correct source names
5. **Phase 4**: AI chat "Why are the front lights on?" → full causal trace

## Definition of Done
- [ ] All tasks checked off
- [ ] Device DON/DOF events attributed to correct source (program/scene/manual/etc.)
- [ ] Device detail shows history panel with source-attributed events
- [ ] AI tools provide causal trace answers
- [ ] `bun run typecheck` passes
- [ ] Pipeline evidence + code-reviewer PASS
- [ ] Plan saved to `docs/plans/device-traceability.md`

## Decisions Log
[Populated during implementation]
