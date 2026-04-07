# eisy-admin — Claude Code Guide

## Critical Gotchas
- `boolAttr(value)` from `@/utils/xml-parser.ts` for ALL XML boolean checks — `true == 'true'` is FALSE in JS
- `String(value)` before `.replace()`, `.split()` on parsed XML fields — fast-xml-parser coerces numbers
- Z-Wave prefixes: not just `ZW` — use `/^z[wylr]\d+/i` (covers ZY, ZL, ZR)
- Tree auto-expand: use `useEffect` + `useRef(hasAutoExpanded)` — `useState` initializer runs before async data
- XML nodes may be missing depending on device firmware — always use optional chaining on parsed XML

## Resilience
- eisy device can be unreachable — all API calls need timeout + user-facing error states, never silent failures
- WebSocket `/rest/subscribe` can drop — implement reconnection with backoff, surface connection status to user

## Tech Stack
- React 18 + TypeScript 5.7 + Vite 6 + Bun
- State: Zustand | Data fetching: TanStack Query | Styling: Tailwind 4
- XML: fast-xml-parser (with parseAttributeValue: true)
- Path alias: `@/*` → `./src/*`

## Code Conventions
- Section dividers: `// ─── Section Name ────`
- Functional components with hooks, no class components
- Zustand stores in `src/stores/`, one store per domain
- API clients in `src/api/`, typed request/response interfaces
- Shared UI components in `src/components/common/`
- Custom hooks in `src/hooks/`

## Commands
- `bun run dev` — Start dev server (port 5173)
- `bun run build` — Typecheck + production build
- `bun run typecheck` — TypeScript check only
- `bun run lint` — ESLint check
- `bun run deploy` — Deploy to eisy device
- `bun run deploy:dry` — Dry-run deploy

## Environment
- eisy device connection is auto-discovered at dev startup and persisted to `.env`
- Configure manually via `.env`: `VITE_EISY_HOST`, `VITE_EISY_PORT`, `VITE_EISY_PROTOCOL`, `VITE_EISY_USER`, `VITE_EISY_PASS`
- Default: `192.168.4.123`, port auto-discovered (known ports: 8443, 8080, 443, 80), Basic Auth `admin/admin`
- Vite proxies: `/rest/*`, `/services/*`, `/program/*`, `/file/*` → eisy (auto-configured)
- WebSocket: `/rest/subscribe` proxied with self-signed cert support
- Portal API: `https://my.isy.io/api/*`
- Port discovery: `scripts/discover-eisy.ts` (Node), `src/utils/discover-eisy.ts` (browser)
