# Plan: Zero-Dependency Installer for Super eisy
Status: ACTIVE

## Context
Super eisy is a web console for Universal Devices eisy home automation controllers. Currently it can only be deployed via `bun run deploy`, which requires Bun/Node. The repo is intended to be public (`mishanovini/eisy-admin`) and used by non-developer eisy owners. We need a one-command installer that requires NO developer tools — just what ships with the OS.

The eisy accepts file uploads via `POST /file/upload/WEB/console/{path}?load=n` with Basic Auth and `application/octet-stream` body. The device typically uses self-signed HTTPS on port 8443 or HTTP on port 8080.

## Goal
Enable any eisy owner to install/update Super eisy with a single command:
- **Windows**: `powershell -c "irm https://raw.githubusercontent.com/mishanovini/eisy-admin/master/install.ps1 | iex"`
- **Mac/Linux**: `curl -fsSL https://raw.githubusercontent.com/mishanovini/eisy-admin/master/install.sh | bash`

## Scope
- IN: GitHub Actions release workflow, PowerShell installer, Bash installer
- OUT: README updates (separate task), repo rename, auto-update mechanism

## Tasks

### Phase 1: GitHub Actions Release Workflow
- [ ] 1. Create `.github/workflows/release.yml` — build on `v*` tag push + manual dispatch
  - Checkout, setup Bun, install, build
  - Zip `dist/` contents (flat, no `dist/` prefix) as `super-eisy-{tag}.zip`
  - Create GitHub Release via `softprops/action-gh-release@v2` with zip attached
  - Release body includes install one-liners for copy-paste

### Phase 2: Bash Installer (Mac/Linux)
- [ ] 2. Create `install.sh` at repo root with these functions:
  - **Dependency check**: Verify `curl` exists; check for `unzip` or `python3` fallback
  - **Credential prompt**: eisy IP (default 192.168.4.123), username (default admin), password (masked via `/dev/tty`)
  - **Discovery**: Probe known ports [8443, 8080, 443, 80] with `curl --connect-timeout 3 -sk` to `/rest/nodes`; check HTTP 200 + body contains `<nodes`; fallback to extended ports [3000, 5000, 8000, 8888, 9443]
  - **Download**: Fetch latest release URL from GitHub API (`/repos/{owner}/{repo}/releases/latest`), parse JSON with grep/sed (no jq dependency), download zip to `mktemp -d`
  - **Extract**: `unzip` preferred, `python3 -c "import zipfile; ..."` fallback
  - **Upload**: For each file, `curl -sk -X POST` with Basic Auth, `--data-binary @{file}`, track success/failure
  - **Summary**: Print URL to access Super eisy, "To update later, run this same command again"
  - Cleanup temp dir via `trap ... EXIT`
  - Read all interactive input from `/dev/tty` (required for `curl | bash` piping)

### Phase 3: PowerShell Installer (Windows)
- [ ] 3. Create `install.ps1` at repo root with these functions:
  - **TLS bypass**: Add C# `TrustAllCertsPolicy` type + set `SecurityProtocol` to TLS 1.2 (PS 5.1 pattern)
  - **Credential prompt**: `Read-Host` for IP (default), username (default), password (`-AsSecureString`)
  - **Discovery**: `Invoke-WebRequest` with `-TimeoutSec 3` to `/rest/nodes`, check status + content for `<nodes`
  - **Download**: `Invoke-RestMethod` to GitHub API (native JSON parsing), download zip to `$env:TEMP`
  - **Extract**: `Expand-Archive` (native in PS 5.1)
  - **Upload**: `Invoke-WebRequest -Method Post -ContentType "application/octet-stream" -Body ([IO.File]::ReadAllBytes($path)) -UseBasicParsing`
  - **Summary**: Same as bash — print access URL and update instructions
  - Cleanup via `try/finally`
  - All web requests to eisy use `-UseBasicParsing` for PS 5.1 compat (no IE engine dependency)

## Files to Create
- `.github/workflows/release.yml` — CI/CD release pipeline
- `install.sh` — Bash installer for Mac/Linux
- `install.ps1` — PowerShell installer for Windows

## Files to Reference (not modify)
- `scripts/discover-eisy.ts` — Node.js discovery logic to replicate in shell scripts
- `scripts/deploy.ts` — Upload logic to replicate in shell scripts

## Key Design Decisions

**No saved connection details**: Scripts are stateless. Saving creds to disk raises security concerns for home automation. The prompt is fast (3 inputs) and discovery is automatic.

**Install = Update**: Re-running the script re-uploads all files (idempotent). No separate update command needed.

**No jq dependency for JSON parsing**: Use grep/sed to extract `browser_download_url` from GitHub API response in bash. PowerShell has native JSON parsing.

**unzip fallback chain (bash)**: `unzip` -> `python3 zipfile` -> fail with clear message.

**Repo coordinates as constants**: Both scripts define `REPO_OWNER` and `REPO_NAME` at the top for easy adjustment if the repo is renamed.

## Testing Strategy

| Test | Verification |
|------|-------------|
| Workflow triggers on tag | Push `v0.2.0-rc1`, check Actions tab for green build |
| Zip structure correct | Download zip, verify `index.htm` + `assets/` at root (no `dist/` prefix) |
| Bash discovery | Run `install.sh` with eisy on network, verify auto-detection |
| Bash discovery failure | Use wrong IP, verify clear error + manual entry option |
| Bash self-signed certs | Verify uploads work against HTTPS eisy (curl -k) |
| Bash upload | Check `https://{eisy}/WEB/console/index.htm` loads after install |
| PS discovery | Same as bash but on Windows |
| PS 5.1 compat | Run on stock Windows 10/11 PowerShell (not pwsh/PS 7) |
| PS cert bypass | Verify TrustAllCertsPolicy allows HTTPS upload |
| Wrong credentials | Enter bad password, verify "Authentication failed" message |
| Re-run (update) | Run twice, verify no errors on second run |
| Partial failure recovery | Interrupt mid-upload, re-run, verify all files present |

## Definition of Done
- [ ] All tasks checked off
- [ ] GitHub Actions workflow creates release with correct zip on tag push
- [ ] `install.sh` works on Mac (or WSL) with eisy on network
- [ ] `install.ps1` works on Windows 10/11 PowerShell 5.1 with eisy on network
- [ ] Both scripts handle discovery failure gracefully
- [ ] Both scripts display clear progress and success/error messages
- [ ] SCRATCHPAD.md updated with final state
- [ ] Completion report appended to this plan file

## Decisions Log
[Populated during implementation]
