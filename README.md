# Super eisy

A modern web console for the **Universal Devices eisy** (IoX) home automation controller. Replaces the legacy Java Admin Console with a fast, responsive interface built on React, TypeScript, and Tailwind CSS.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-0.1.0-green.svg)
![Built with Claude Code](https://img.shields.io/badge/built%20with-Claude%20Code-orange.svg)

## Features

### Device Management
- **127+ device support** across Insteon, Z-Wave, and IR protocols
- Real-time status updates via WebSocket subscription
- Device control (on/off, dimming, lock/unlock) with inline controls
- Hierarchical folder tree with drag-free navigation
- Battery monitoring dashboard with health indicators

### Programs & Scenes
- View and manage ISY programs with run/stop controls
- D2D (device-to-device) schedule visualization
- Scene membership viewer with responder/controller roles
- Program schedule calendar with timeline view

### AI Assistant
- **Multi-provider support**: Claude (Anthropic), GPT (OpenAI), Gemini (Google)
- Tool-calling integration for device control, program execution, and status queries
- Conversation history with token usage tracking
- Auto-validated API keys with visual status indicators
- Knowledge Base capture for troubleshooting history

### Voice Control (Google Home)
- ISY Portal integration for managing Google Home spoken entries
- 3-step device picker modal (Category > Device > Configure)
- Room management with CRUD operations
- Sync-to-Google-Home with activity logging
- 5 alternate spoken names per device

### System
- SMTP notification configuration with provider presets
- Backup/restore for ISY configuration files
- Network health diagnostics
- Real-time event log with category filtering
- Command palette search (Ctrl+K / Cmd+K)
- Dark mode with system preference detection

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Styling | Tailwind CSS 4 (via `@tailwindcss/vite`) |
| State | Zustand (8 stores) |
| Routing | React Router v7 |
| Icons | Lucide React |
| XML Parsing | fast-xml-parser |
| Storage | IndexedDB (via `idb`) for logs + Knowledge Base |
| Build | Vite 6 + Bun |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+
- An eisy controller on your local network

### Install & Run

```bash
# Clone the repository
git clone https://github.com/mishanovini/eisy-admin.git
cd eisy-admin

# Install dependencies
bun install

# Start dev server
bun run dev
```

The app opens at `http://localhost:5173/WEB/console/`. Enter your eisy's IP address and credentials (default: `admin` / `admin`).

### Build for Production

```bash
bun run build
```

Output goes to `dist/`. The build automatically renames `index.html` to `index.htm` for eisy deployment compatibility (the eisy web server has a MIME type issue with `.html` files).

### Deploy to eisy

```bash
# Deploy built files to eisy via SCP
bun run deploy

# Preview what would be deployed (dry run)
bun run deploy:dry
```

## Project Structure

```
src/
  ai/             # AI provider abstraction, tool definitions, KB capture
  api/            # REST client, SOAP client, portal API, type definitions
  components/
    ai/           # AI chat panel
    auth/         # Login screen
    batteries/    # Battery monitoring
    common/       # Shared UI (ConfirmDialog, SearchPalette, etc.)
    controls/     # Device control widgets
    dashboard/    # Dashboard cards and stats
    devices/      # Device tree, detail views
    integration/  # Knowledge Base
    layout/       # AppShell, Sidebar, TopBar, StatusBar
    logs/         # Event log viewer
    network/      # Network diagnostics
    programs/     # Program list, detail, D2D viewer
    scenes/       # Scene list and detail
    schedule/     # Calendar timeline
    settings/     # AI config, Voice Control, Notifications, etc.
    tree/         # Folder tree component
    troubleshoot/ # Troubleshooter wizard
  hooks/          # Custom React hooks (WebSocket, KB capture, etc.)
  stores/         # Zustand state stores
  utils/          # Device types, XML parser helpers, formatting
```

## Architecture Notes

### Communication with eisy

The app communicates with the eisy controller via:

1. **REST API** (`/rest/*`) for device queries, status, and control commands
2. **SOAP API** (`/services`) for system operations (notifications, config, diagnostics)
3. **WebSocket** (`/rest/subscribe`) for real-time event streaming

In development, Vite proxies all three to the eisy at `192.168.4.123:8443` (configurable in `vite.config.ts`). The WebSocket proxy uses a custom plugin because Vite's built-in WS proxy doesn't handle self-signed certificates.

### AI Provider Integration

The AI assistant supports tool calling across all three providers. Tool definitions in `src/ai/tools.ts` are converted to each provider's native format (Claude tool_use, OpenAI function calling, Gemini functionDeclarations). The tool execution loop handles up to 5 iterations of tool calls per message.

OpenAI's chat completions endpoint blocks browser CORS, so a Vite dev proxy routes `/openai-api/*` to `https://api.openai.com`. Claude and Gemini APIs support direct browser access.

### Portal Integration

Voice Control connects to the ISY Portal (`my.isy.io`) for Google Home management. A Vite dev proxy (`/portal-api/*`) bypasses the portal's broken CORS preflight handler. Credentials are stored in localStorage with Basic Auth encoding.

## Configuration

### eisy Connection
Enter your eisy's IP, port, and credentials on the login screen. Connection details are saved in localStorage for auto-reconnect.

### AI API Keys
Navigate to **Settings > AI Assistant** to configure your preferred AI provider and API key. Keys are stored in localStorage (browser-only, never sent to any server besides the AI provider).

### Voice Control
Navigate to **Settings > Voice Control** to connect your ISY Portal account. This enables Google Home voice entry management directly from the app.

## Development

```bash
# Type checking
bun run typecheck

# Linting
bun run lint

# Dev server with hot reload
bun run dev
```

### Key Development Patterns

- **`boolAttr()` for XML booleans**: `fast-xml-parser` converts `"true"` to boolean `true`, but `true == 'true'` is `false` in JS. Always use `boolAttr()` from `@/utils/xml-parser.ts`.
- **`String()` for XML addresses**: The parser coerces numeric-looking strings to numbers. Always wrap parsed addresses in `String()` before string operations.
- **Z-Wave device prefixes**: Not just `ZW` -- Yale locks use `ZY`, others use `ZL`, `ZR`. Use regex `/^z[wylr]\d+/i`.

## Disclaimers

- Not affiliated with Universal Devices Inc.
- Tested on Insteon, Z-Wave, and IR devices
- AI features require your own API key (usage costs apply)
- Portal and eisy credentials are stored in browser localStorage -- do not use on shared computers

## License

MIT

## Author

**Misha Novini** -- [LinkedIn](https://www.linkedin.com/in/mishanovini) | [GitHub](https://github.com/mishanovini)

Built with [Claude Code](https://claude.ai/claude-code) by Anthropic.
