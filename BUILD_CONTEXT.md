# eisy Admin Console — Build Context
## Created: 2026-02-24 | For use by Claude Code in the build session

This file supplements the approved build plan at:
`C:\Users\misha\.claude\plans\golden-wibbling-hammock.md`

It captures decisions, discoveries, and context from the planning sessions that
are NOT in the plan file but are needed for the build.

---

## Project Location
`C:\Users\misha\OneDrive\Documents\Claude Working Folder\eisy-admin`

## Permissions Pre-Approved
The user has pre-approved all of the following without needing to ask:
- npm init / npm install / npx (package management)
- Dev server start/restart (Vite)
- npm run build / npm test / npx tsc (build & test)
- curl to https://192.168.4.123:8443 (eisy REST/SOAP API calls)
- git init / git add / git commit (version control)
- NOT git push (ask first)

---

## Feature Addition: Integration Knowledge Base

**Not in the plan file yet.** User proposed this feature during planning sessions.

### Purpose
Primary: Provide context to the AI chatbot about all integrated devices/systems.
Secondary: Give users a reference for their integration topology.

### Storage Design (User-Approved Approach)
- **Total local storage target: under 1 MB**
- Store ONLY curated text/JSON locally (metadata, context summaries, mapping tables)
- External resources (manuals, wikis, vendor docs) stored as **links only** with metadata
- No PDFs, images, or large files stored locally
- Use IndexedDB alongside the existing log storage

### Data Model

#### Integration Profiles (~1-5 KB each)
```json
{
  "id": "harmony-ir",
  "name": "Harmony Remote → eisy IR Control",
  "type": "ir-control",
  "protocol": "RC5 via Flirc USB",
  "signalChain": ["Harmony Remote (RF)", "Harmony Hub", "IR Blaster (RC5)", "Flirc USB", "eISYIR Node Server", "ISY Button Node", "Program Trigger"],
  "devices": ["Harmony Hub", "Flirc 2.0"],
  "notes": "Toggle-bit fix applied 2026-02-24. Works inside cabinet.",
  "lastUpdated": "2026-02-24"
}
```

#### Mapping Tables (~1-5 KB each)
Structured versions of files like Harmony-eisy-IR-Mapping.txt.
These are the highest-value items for the chatbot — they let it understand
how controls map across device boundaries.

#### AI Context Documents (~5-20 KB each)
Curated summaries written FOR the chatbot, containing:
- Device capabilities and limitations
- Known issues and workarounds
- Protocol quirks (e.g., RC5 toggle bit, Z-Wave wake requirements)
- Configuration best practices

#### External References (~300 bytes each)
```json
{
  "type": "manual",
  "device": "Yale YRD256",
  "title": "Installation & Programming Guide",
  "url": "https://...",
  "version": "Rev C, 2024",
  "keyPages": "p23: master code reset. p31: Z-Wave inclusion."
}
```

#### Troubleshooting History (~1-3 KB each)
Structured records of past issues and resolutions, so the chatbot
can recognize recurring patterns and suggest proven fixes.

### Architecture Pattern
This is a "curated context" approach, NOT RAG (Retrieval-Augmented Generation).
The chatbot loads relevant context documents based on query topic, rather than
embedding and vector-searching entire manuals. For a home automation system
with ~20 integrations, curated context is dramatically more efficient and
often more accurate because it captures institutional knowledge.

The chatbot can also "deep dive" — follow stored links to fetch external
resources on demand when curated context isn't sufficient.

---

## D2D Protocol (Reverse-Engineered from Admin Console JAR)

This is critical for the program editor feature.

### Reading Programs
```
POST /services
SOAPACTION: "urn:udi-com:service:X_Insteon_Lighting_Service:1#GetAllD2D"

Response contains:
- <key>VALUE</key>  ← needed for uploads
- <triggers><d2d><trigger>...</trigger></d2d>...</triggers>
```

### Writing Programs
```
POST /program/upload/{HEX_ID}?key={KEY}
Content-Type: text/xml
Body: Full trigger XML
```

### Program XML Format
```xml
<?xml version="1.0" ?><triggers><d2d><trigger>
  <id>{decimal_id}</id>
  <name>{name}</name>
  <parent>{parent_folder_decimal_id}</parent>
  <if>
    <and /><condition1>
    <or /><condition2>
    <and /><paren>      <!-- nested group -->
      <or /><condition3>
      <or /><condition4>
    </paren>
  </if>
  <then>
    <cmd id="DON" node="{addr}"><p id=""><val uom="51" prec="0">255</val></p></cmd>
    <wait><minutes>5</minutes></wait>
    <runthen>{other_program_id}</runthen>
    <enable>{program_id}</enable>
    <disable>{program_id}</disable>
    <notify content="1">1</notify>
  </then>
  <else>...</else>
  <comment>Optional comment text</comment>
</trigger></d2d></triggers>
```

### Condition Types (found in existing programs)
```xml
<!-- Device status check -->
<status id="ST" node="{addr}" op="IS|LT|GT"><val uom="51" prec="0">{value}</val></status>

<!-- Control event (button press, etc.) -->
<control id="GV1|GV2|DON|DOF|DFON|DFOF" node="{addr}" op="IS"></control>

<!-- Schedule -->
<schedule><from><sunset>0</sunset></from><to><sunrise>0</sunrise><day>1</day></to></schedule>
<schedule><at><time>{seconds_from_midnight}</time></at></schedule>
<schedule><daysofweek><mon /><tue />...</daysofweek><from>...</from><to>...</to></schedule>

<!-- Nested group (parenthesized OR) -->
<paren><or /><condition1><or /><condition2></paren>
```

### Action Types (found in existing programs)
```xml
<cmd id="DON|DOF|LOCK|UNLOCK|FDUP|FDDOWN|FDSTOP|QUERY" node="{addr}">
  <p id=""><val uom="51" prec="0">{value}</val></p>  <!-- optional parameter -->
</cmd>
<wait><hours>1</hours><minutes>5</minutes><seconds>10</seconds></wait>
<runthen>{program_id}</runthen>       <!-- run another program's THEN -->
<runif>{program_id}</runif>           <!-- run another program's IF check -->
<enable>{program_id}</enable>
<disable>{program_id}</disable>
<notify content="{msg_id}">{channel_id}</notify>
<device><group>{uuid}</group><control>ST</control></device>  <!-- query all -->
<net><cmd>6</cmd><parm>1</parm></net>  <!-- network resource command -->
```

### Conjunction Logic
- `<and />` prefix before first condition, then `<or />` for OR'd conditions
- The FIRST `<and />` is a prefix marker, NOT a conjunction between items
- Subsequent `<and />` markers create AND junctions
- `<or />` creates OR junctions
- `<paren>` groups create nested evaluation blocks

### HEX ID Conversion
Program IDs in URLs are 4-digit uppercase hex of the decimal ID.
Example: id=15 → 000F, id=50 → 0032

### CRITICAL: Full Program Save Sequence
Uploading XML alone does NOT activate the program. The eisy runtime must be
notified via the D2DCommand broadcast mechanism. The full sequence is:

1. **Rotate key (pre-save):** SOAP D2DCommand with `<setKey>{NEW_KEY}</setKey>`
   (no broadcast flag). This generates a new session key.
   Key format: `String.format("%X.%04X", System.currentTimeMillis() & mask, randomExt)`

2. **Upload XML:** POST `/program/upload/{HEX_ID}?key={NEW_KEY}` with program XML body

3. **Enable/disable:** SOAP D2DCommand with `<enable />` or `<disable />` and program ID

4. **Run-at-reboot:** SOAP D2DCommand with `<runAtReboot />` or `<notRunAtReboot />`

5. **Delete programs (if any):** SOAP D2DCommand with `<delete />` and `<mask>{bitmask}</mask>`

6. **Broadcast commit:** SOAP D2DCommand with `<broadcast /><setKey>{NEWEST_KEY}</setKey>`
   THIS IS THE CRITICAL STEP — it tells the eisy runtime to reload programs.

D2DCommand SOAP envelope format:
```xml
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
            s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:D2DCommand xmlns:u="urn:udi-com:service:X_Insteon_Lighting_Service:1">
      <id>{PROGRAM_ID_OR_0}</id>
      <key>{CURRENT_KEY}</key>
      <CDATA><cmd>{COMMAND_XML}</cmd></CDATA>
    </u:D2DCommand>
  </s:Body>
</s:Envelope>
```
SOAPACTION: "urn:udi-com:service:X_IoX_Service:1#D2DCommand"
NOTE: D2DCommand uses X_IoX_Service, NOT X_Insteon_Lighting_Service!
      GetAllD2D uses X_Insteon_Lighting_Service. They are DIFFERENT services.

LESSON LEARNED: Without the broadcast in step 6, the program XML is saved to
disk but the runtime doesn't pick it up until the next reboot or manual re-save
from the Admin Console.

---

## Admin Console Backwards Compatibility

CONFIRMED: The new app IS backwards compatible with the Admin Console.

Both the Admin Console (Java) and our new app use the exact same D2D protocol
to read and write programs. Programs are stored on the eisy, not in either
client. Users can freely switch between both apps.

Scenes are stored in the devices themselves (Insteon link tables), so they're
inherently shared. Device definitions and folder structure are stored on the
eisy and accessed via the same REST/SOAP APIs by both clients.

---

## GV1 vs GV2 (Generic Values)

In the ISY/IoX ecosystem:
- **ST** = Status (standard property)
- **GV1-GV25** = Generic Values (custom properties per node server)

For eISYIR button nodes specifically:
- **GV1** = Button pressed (short press / tap)
- **GV2** = Button held down (long press / repeat)

This is used cleverly in the TV programs:
- Chan Up/Down GV1 → Theater Lights Up/Down (1-second adjustment)
- Chan Up/Down GV2 → Theater Lights Up/Down More (2-second adjustment)
- Play/Pause/Menu/Back trigger on BOTH GV1 and GV2

---

## eisy Device Reference

- **Host:** 192.168.4.123
- **Ports:** 80 (eisy-ui), 8080 (HTTP), 8443 (HTTPS)
- **Auth:** Basic Auth, admin/admin
- **IoX Version:** 6.0.0
- **WebSocket:** wss://192.168.4.123:8443/rest/subscribe (protocol: ISYSUB)
- **File upload:** POST /file/upload/WEB/console/{path}?load=n
- **Serve app:** GET /WEB/console/{path}
- **CRITICAL:** Must use .htm extension, NOT .html (eisy MIME type bug)

## Key Reference Files
All in `C:\Users\misha\OneDrive\Documents\Software\ISY\`:
- `Harmony-eisy-IR-Mapping.txt` — Complete IR integration documentation
- `ISY IR Flirc key map.txt` — IR command to keyboard key mapping
- Flirc config files (.fcfg)

## Decompiled Admin Console JAR
May be at `C:\Users\misha\AppData\Local\Temp\iox_decompiled\` (Temp, may not survive reboot).
Can be re-downloaded: `curl -k -u admin:admin https://192.168.4.123:8443/WEB/iox.jar`
Contains all protocol details for SOAP operations, D2D format, device types, etc.

---

## Complete SOAP API Catalog (Reverse-Engineered from JAR)

All SOAP calls: POST /services, Content-Type: text/xml, SOAPACTION header.

### Node/Device Management
| SOAP Action | Parameters | Purpose |
|---|---|---|
| RenameNode | name, newName | Rename a device |
| RenameGroup | name, newName | Rename a scene |
| RenameFolder | name, newName | Rename a folder |
| AddNode | (node info) | Add a new device |
| RemoveNode | id | Remove a device |
| AddFolder | name, id | Create folder |
| RemoveFolder | id | Delete folder |
| MoveNode | node + parent info | Move node between folders |
| SetParent | parent, parentType | Set folder for a node |
| SetNodeEnabled | node, flag | Enable/disable a node |
| DiscoverNodes | (none) | Start device discovery |
| CancelNodesDiscovery | (none) | Cancel discovery |
| ReplaceDevice | (device info) | Replace a device |
| QueryAll | (none) | Query all device statuses |

### Scene Management
| SOAP Action | Parameters | Purpose |
|---|---|---|
| AddGroup | name + member info | Create a new scene |
| RemoveGroup | group address | Delete a scene |
| RemoveFromGroup | node, group info | Remove member from scene |
| DeviceSpecific | command, node | Set on-level, ramp rate, etc. |
| SetDeviceLinkMode | flag (32=Insteon, 65=ZWave) | Enter linking mode |

### Device Configuration
| SOAP Action | Parameters | Purpose |
|---|---|---|
| GetNodeDeviceProps | node address | Read device properties |
| SetNodeDeviceProps | node + properties XML | Write device properties |
| GetNodesConfig | (none) | Get all nodes configuration |
| WriteDeviceUpdates | device info | Write pending updates to device |
| RefreshDeviceStatus | node info | Force status refresh |
| SetNodePowerInfo | node, deviceClass, wattage, etc. | Set power monitoring |
| DeviceSpecific | command, node | Generic device-specific command |

### Z-Wave Specific
| SOAP Action | Parameters | Purpose |
|---|---|---|
| QueryConfigParam | node, param number | Read Z-Wave config parameter |
| SetConfigParam | id, val, size | Write Z-Wave config parameter |
| GetNodeProperty | id, name | Get Z-Wave node property |
| SetNodeProperty | id, name, val | Set Z-Wave node property |
| GetNodeDef | node address | Get Z-Wave node definition |
| UserSetCode | id, code | Set lock user code |
| UserQuery | user number | Query lock user code |
| UserDelete | user number | Delete lock user code |
| UserSetRole | id, role | Set lock user role |
| UserSetSchedule | id, slot, userNum, start, stop, day, duration | Set lock schedule |
| UserDeleteSchedule | schedule id | Delete lock schedule |
| UserEnableSchedule | schedule id | Enable lock schedule |
| UserDisableSchedule | schedule id | Disable lock schedule |

Z-Wave DeviceSpecific command codes:
- `ZWAVE:QUICK:CONFIG` — quick config
- `ZWAVE:LINK:INCLUDE` / `EXCLUDE` / `SYNC` — link management
- `ZWAVE:REPAIR` — network repair
- `ZWAVE:NEIGHBOR:NODE` — neighbor update

### Programs (Hybrid SOAP + REST)
| Mechanism | URL/Action | Purpose |
|---|---|---|
| SOAP GetAllD2D | POST /services | Read all programs with conditions/actions |
| HTTP POST | /program/upload/{HEX_ID}?key={KEY} | Create or update a program |
| HTTP | /program/delete/{HEX_ID} | Delete a program |
| REST | /rest/programs/{id}/run\|stop\|enable\|disable | Control program execution |

Program folder creation: Upload program XML with `<folder />` tag.

### Variables
| SOAP Action | Parameters | Purpose |
|---|---|---|
| GetVariables | (none) | Get all variables |
| SetVariable | (var info) | Set a variable value |

### Notifications
| SOAP Action | Parameters | Purpose |
|---|---|---|
| GetSMTPConfig | (none) | Get email config |
| SetSMTPConfig | SMTPServer, Port, UID, PWD, From, Timeout, UseTLS | Set email config |
| SendTestEmail | (none) | Send test email |
| ResetNot | (none) | Reset notifications |
| GetNumPendNot | (none) | Get pending notification count |

Notification rules stored as config files in `/CONF/MAIL/NOTIF.CFG`.
Each rule has id, name, and list of email addresses.

### Network Resources
Config files stored at `/CONF/NET/RES.CFG`.
Managed via file upload/delete operations to `/file/upload` and `/file/delete`.
| SOAP Action | Purpose |
|---|---|
| TestNetResource | Test a network resource |

### File System Operations (REST, not SOAP)
| Endpoint | Purpose |
|---|---|
| POST /file/upload/{path}?load=n | Upload file |
| /file/delete/{path} | Delete file |
| /file/mkdir/{path} | Create directory |
| /file/rmdir/{path} | Remove directory |

### System Administration
| SOAP Action | Purpose |
|---|---|
| Authenticate | Authenticate with device |
| GetISYConfig | Get ISY configuration |
| GetSysConf | Get system configuration |
| GetSystemStatus | Get system status |
| GetSystemTime | Get system time |
| SetSystemTime | Set system time |
| GetNetworkConfig | Get network config |
| SetNTPOptions | Set NTP time sync |
| SynchWithNTS | Sync with NTP server |
| Reboot | Reboot device |
| GetErrorLog | Get error log |
| ResetErrorLog | Reset error log |
| SetDebugLevel | Set debug level |
| SetUserCredentials | Set user credentials |
| InternetAccess | Enable/disable internet access |
| GetSystemOptions | Get system options |
| SetSystemOptions | Set system options |
