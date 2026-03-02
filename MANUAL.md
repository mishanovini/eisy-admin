# Super eisy User Manual

A complete guide to using the Super eisy web console for managing your Universal Devices eisy home automation controller.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Dashboard](#dashboard)
3. [Devices](#devices)
4. [Scenes](#scenes)
5. [Programs](#programs)
6. [Batteries](#batteries)
7. [Logs](#logs)
8. [Schedule](#schedule)
9. [Network Health](#network-health)
10. [Troubleshooter](#troubleshooter)
11. [Knowledge Base](#knowledge-base)
12. [AI Assistant](#ai-assistant)
13. [Voice Control (Google Home)](#voice-control-google-home)
14. [Notifications](#notifications)
15. [Settings](#settings)
16. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Getting Started

### Connecting to Your eisy

1. Open the app in your browser at `http://localhost:5173/WEB/console/`
2. Enter your eisy's **IP address** (e.g., `192.168.4.123`)
3. Enter the **port** (default: `8443`)
4. Enter your **username** and **password** (default: `admin` / `admin`)
5. Click **Connect**

Your connection details are saved automatically and will be restored on your next visit.

### Navigation

The left sidebar provides access to all sections:
- **Dashboard** -- Overview of your system
- **Devices** -- Browse and control individual devices
- **Scenes** -- Manage Insteon scenes and Z-Wave groups
- **Programs** -- View and control ISY programs
- **Batteries** -- Monitor battery-powered devices
- **Logs** -- View event history
- **Schedule** -- Calendar view of program schedules
- **Network Health** -- Diagnostics for your device network
- **Troubleshooter** -- Guided troubleshooting wizard
- **Knowledge Base** -- Saved device knowledge and troubleshooting history
- **Settings** -- AI configuration, Voice Control, Notifications, Connection, and About

The sidebar can be collapsed by clicking the `<` icon at the top.

---

## Dashboard

The dashboard provides a quick overview of your entire system:

- **Device count** -- Total devices across all protocols
- **Program count** -- Total programs with running count
- **Low Batteries** -- Devices below battery threshold
- **Recent Events** -- Count of events in the log

### Battery Status
Shows the 3 lowest-battery devices with percentage bars. Click **View all** to go to the full Batteries page.

### Programs
Shows currently running programs with their status. Click **View all** to go to Programs.

### Recent Events
Shows the latest system events. Click **View all** to go to the full Logs page.

Click **Refresh** to reload all dashboard data.

---

## Devices

### Device Tree
The Devices page shows all your devices in a hierarchical folder tree matching your ISY folder structure. Each device shows:
- **Name** and protocol icon (Insteon, Z-Wave, IR)
- **Status** (on/off/dim level/lock state)
- **Type** label (Dimmer, Switch, Lock, Sensor, etc.)

### Controlling Devices
Click on any device to open its detail panel:
- **On/Off toggle** for switches and relays
- **Dim slider** for dimmers (0-100%)
- **Lock/Unlock** for door locks
- Status properties display (temperature, humidity, battery, etc.)

### Search
Use the search bar or press **Ctrl+K** (Cmd+K on Mac) to quickly find any device, scene, or program by name.

---

## Scenes

Scenes (called "groups" in ISY) control multiple devices simultaneously.

### Scene List
Shows all scenes with their member count. Click a scene to see:
- **Controllers** -- Devices that trigger the scene
- **Responders** -- Devices that react when the scene is activated
- On/Off levels for each responder

### Controlling Scenes
- **On** -- Activates all responders to their configured levels
- **Off** -- Turns off all responders

---

## Programs

### Program List
Shows all ISY programs organized by folder. Each program displays:
- **Name** and folder path
- **Status** (Idle, Running, Then/Else)
- **Enabled/Disabled** state

### Program Actions
- **Run Then** -- Execute the program's "Then" actions
- **Run Else** -- Execute the program's "Else" actions
- **Stop** -- Stop a running program
- **Enable/Disable** -- Toggle program activity

### D2D Viewer
Programs with device-to-device (D2D) triggers show a visual breakdown of their conditions and schedule blocks with humanized descriptions.

---

## Batteries

The Batteries page monitors all battery-powered devices:

- **Battery level** with color-coded bars (green/yellow/red)
- **Device type** and protocol
- **Health status** (Good, Low, Critical)

Devices are sorted by battery level (lowest first) so you can quickly identify which batteries need replacing.

---

## Logs

### Event Log
The Logs page shows all system events in reverse chronological order:
- **Device events** (on, off, status changes)
- **Program events** (run, stop, status)
- **System events** (errors, warnings)
- **Portal events** (voice control operations)

### Filtering
- Filter by **category** (device, program, system, portal)
- Filter by **result** (success, error)
- **Search** by action or detail text
- **Date range** filtering

Events are stored in IndexedDB for offline access. Use **Settings > About > Purge Logs** to clean up entries older than 30 days.

---

## Schedule

The Schedule page shows a calendar timeline of all program schedules:
- Programs with time-based triggers appear on their scheduled days
- Visual timeline shows when programs run throughout the day
- Click any program to view its detail

---

## Network Health

Diagnostics for your device network:
- **Protocol breakdown** -- Insteon vs Z-Wave vs IR device counts
- **Communication health** -- Devices with recent communication failures
- **Signal strength** -- For Z-Wave devices that report signal metrics

---

## Troubleshooter

A guided wizard for diagnosing common issues:
1. Select the type of problem (device not responding, program not running, etc.)
2. Follow step-by-step diagnostic checks
3. The AI Assistant can help research solutions if configured

---

## Knowledge Base

A local database of device knowledge and troubleshooting history:

### Entries
Each entry contains:
- **Title** and description
- **Device type** association (linked to integration profiles)
- **Tags** for categorization
- **Troubleshooting flag** for issue/resolution pairs

### Auto-Capture
When the AI Assistant is configured, the Knowledge Base can automatically capture:
- New device discoveries
- Resolved troubleshooting incidents
- Recurring error patterns
- AI-researched device information

Configure auto-capture in **Settings > AI Assistant > Auto-Capture**.

---

## AI Assistant

The AI Assistant provides natural language control and help for your smart home.

### Setup
1. Go to **Settings > AI Assistant**
2. Select your **Provider** (Claude, OpenAI, or Gemini)
3. Enter your **API Key** (get one from the linked provider console)
4. Wait for the green checkmark confirming your key works
5. Select a **Model** from the dropdown

### Using the Assistant
Click the blue chat bubble in the bottom-right corner to open the AI panel. You can ask it to:

- **Control devices**: "Turn on the backyard lights" / "Dim the bedroom to 50%"
- **Run programs**: "Run the Good Morning program"
- **Check status**: "What's the battery level on the side gate lock?"
- **Troubleshoot**: "The kitchen switch isn't responding, help me diagnose"
- **Research**: "What's the range of Insteon devices?"

The assistant has access to your full device inventory and can execute commands with your confirmation.

### Token Usage
The Session Usage section tracks input/output tokens and estimated cost for the current session. Costs reset when you refresh the page.

### Supported Providers

| Provider | Models | Notes |
|----------|--------|-------|
| **Claude** (Anthropic) | Sonnet 4.6, Opus 4.6, Haiku 4.5 | Direct browser access, best tool calling |
| **OpenAI** (GPT) | GPT-4o, GPT-4.1, etc. | Requires dev proxy for chat (CORS restriction) |
| **Gemini** (Google) | Gemini 2.0 Flash, 2.5 Pro/Flash | Direct browser access |

---

## Voice Control (Google Home)

Manage your Google Home voice entries through the ISY Portal integration.

### Connecting to the Portal
1. Go to **Settings > Voice Control**
2. Enter your **my.isy.io email** and **password**
3. Click **Connect to Portal**

Your portal credentials are saved and auto-restored on future visits.

### Managing Spoken Entries

Spoken entries define what you can say to Google Home to control your devices.

#### Viewing Entries
Entries are grouped by room. Each entry shows:
- **Device name** and address
- **Google Home type** (Light, Switch, Lock, etc.)
- **Spoken names** (up to 5 alternate names per device)

Use the search bar to filter entries by name or address.

#### Adding an Entry
1. Click **+ Add Entry** to open the device picker
2. **Step 1**: Choose a category (Standard Device, Scene, Program, or Lock)
3. **Step 2**: Search and select a device from the list
4. **Step 3**: Configure spoken names, room assignment, and Google Home type
5. Click **Add Entry** to create it

The primary spoken name is auto-filled from the device name (lowercased). The Google Home type is auto-suggested based on the device category.

#### Editing an Entry
Click the pencil icon on any entry to enter edit mode:
- Modify any of the 5 spoken names
- Change the room assignment
- Change the Google Home type
- Click the checkmark to save or X to cancel

#### Deleting an Entry
Click the trash icon and confirm. The deletion won't take effect in Google Home until you sync.

#### Syncing to Google Home
Click **Sync to Google Home** to push all changes to Google. This updates your Google Home device list to match your portal entries.

### Managing Rooms
Click **Show** on the Rooms section to expand it:
- **Add Room** -- Click "+ Add Room" and type a name
- **Rename** -- Click the pencil icon next to any room
- **Delete** -- Click the trash icon (devices in the room won't be deleted, just unassigned)

### Portal Activity
Click **Show** on the Portal Activity section to see a log of all portal API interactions with timestamps and success/failure indicators.

---

## Notifications

### SMTP Configuration
Configure email notifications for your eisy:

1. Go to **Settings > Notifications**
2. Select a **provider preset** (Gmail, Outlook, Yahoo, etc.) or enter custom SMTP settings
3. Configure **server**, **port**, **username**, **password**, and **TLS** settings
4. Click **Save SMTP Config** to write settings to the eisy

If your eisy uses the default Universal Devices mail relay, the fields may appear empty -- this is normal. Emails will still work through the built-in relay.

### Gmail Setup
If using Gmail:
1. Select "Gmail" from the preset dropdown
2. Enter your Gmail address as the username
3. Use a [Google App Password](https://myaccount.google.com/apppasswords) (not your regular password)
4. Enable TLS

---

## Settings

### AI Assistant
Configure your AI provider, API key, and model. See [AI Assistant](#ai-assistant) for details.

### Voice Control
Connect to ISY Portal for Google Home management. See [Voice Control](#voice-control-google-home) for details.

### Notifications
Configure SMTP email settings. See [Notifications](#notifications) for details.

### Connection
View your current connection details:
- Host and port
- Connection status
- Platform and firmware version

System actions:
- **Query All Devices** -- Sends a status query to every device
- **Clear Errors** -- Clears the last error flag on all devices
- **Disconnect** -- Returns to the login screen

### Backup & Restore
- **Backup** -- Download your eisy's configuration as a ZIP file
- **Restore** -- Upload a configuration backup to your eisy

### About
Version info, developer credits, and data management:
- **Purge Logs** -- Delete log entries older than 30 days

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `Cmd+K` | Open command palette search |
| `Escape` | Close search, close modals |
| `?` | Show icon legend |

### Command Palette
The command palette lets you quickly jump to any device, scene, or program:
1. Press `Ctrl+K` (or `Cmd+K` on Mac)
2. Start typing a name
3. Select from the filtered results
4. Press `Enter` to navigate

---

## Troubleshooting the App

### "Failed to connect"
- Verify your eisy's IP address and port
- Ensure your eisy is powered on and connected to the network
- Check that you're using HTTPS port 8443 (not HTTP 80)
- Try the default credentials: `admin` / `admin`

### AI Assistant errors
- **"Please configure your AI API key"** -- Go to Settings > AI Assistant and enter your key
- **"Authentication failed (HTTP 401)"** -- Your API key is invalid or expired
- **"Rate limit exceeded (HTTP 429)"** -- Wait a moment and try again
- **"Network error"** -- The AI provider may be down; check their status page

### Voice Control not loading
- Ensure you're connected to the ISY Portal (Settings > Voice Control)
- Check your portal credentials are correct
- The portal API requires internet access

### Chrome autofilling wrong credentials
The app uses non-standard `autoComplete` attributes to prevent Chrome from autofilling eisy login credentials into SMTP or AI key fields. If Chrome still autofills, try:
1. Clearing Chrome's saved passwords for your eisy's IP
2. Using an incognito window

---

*Super eisy v0.1.0 -- Built with [Claude Code](https://claude.ai/claude-code) by Anthropic*
