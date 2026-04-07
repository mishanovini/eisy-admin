#!/usr/bin/env bash
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
REPO_OWNER="mishanovini"
REPO_NAME="eisy-admin"
DEFAULT_HOST="192.168.4.123"
DEFAULT_USER="admin"
KNOWN_PORTS=(8443 8080 443 80)
EXTENDED_PORTS=(3000 5000 8000 8888 9443)
PROBE_TIMEOUT=3

# ─── Colors & Output ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()    { printf "${BLUE}[info]${NC}  %s\n" "$*"; }
success() { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn()    { printf "${YELLOW}[warn]${NC}  %s\n" "$*"; }
error()   { printf "${RED}[error]${NC} %s\n" "$*" >&2; }

banner() {
  printf "\n${CYAN}${BOLD}"
  printf "  ╔═══════════════════════════════════════╗\n"
  printf "  ║        Super eisy Installer           ║\n"
  printf "  ╚═══════════════════════════════════════╝\n"
  printf "${NC}\n"
}

# ─── Cleanup ──────────────────────────────────────────────────────────────────
WORK_DIR=""
cleanup() {
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

# ─── Dependency Check ─────────────────────────────────────────────────────────
check_dependencies() {
  if ! command -v curl &>/dev/null; then
    error "curl is required but not installed."
    error "Install it with: sudo apt install curl (Linux) or brew install curl (Mac)"
    exit 1
  fi

  # Check for a zip extraction method
  if command -v unzip &>/dev/null; then
    EXTRACT_CMD="unzip"
  elif command -v python3 &>/dev/null; then
    EXTRACT_CMD="python3"
  else
    error "Neither 'unzip' nor 'python3' found."
    error "Install one: sudo apt install unzip (Linux) or brew install unzip (Mac)"
    exit 1
  fi
}

# ─── Prompt for Credentials ──────────────────────────────────────────────────
prompt_credentials() {
  printf "\n${BOLD}eisy Connection Details${NC}\n"
  printf "${DIM}Press Enter to accept defaults shown in [brackets]${NC}\n\n"

  printf "  eisy IP address [${DEFAULT_HOST}]: "
  read -r EISY_HOST < /dev/tty
  EISY_HOST="${EISY_HOST:-$DEFAULT_HOST}"

  printf "  Username [${DEFAULT_USER}]: "
  read -r EISY_USER < /dev/tty
  EISY_USER="${EISY_USER:-$DEFAULT_USER}"

  printf "  Password: "
  read -rs EISY_PASS < /dev/tty
  printf "\n"

  if [ -z "$EISY_PASS" ]; then
    EISY_PASS="admin"
  fi

  AUTH_HEADER="$(printf '%s:%s' "$EISY_USER" "$EISY_PASS" | base64 | tr -d '\n')"
}

# ─── Port Discovery ──────────────────────────────────────────────────────────
probe_port() {
  local host="$1" proto="$2" port="$3"
  local url="${proto}://${host}:${port}/rest/nodes"

  local http_code body
  body=$(curl -sk --connect-timeout "$PROBE_TIMEOUT" --max-time "$((PROBE_TIMEOUT + 2))" \
    -H "Authorization: Basic ${AUTH_HEADER}" \
    -w "\n%{http_code}" \
    "$url" 2>/dev/null) || return 1

  http_code=$(echo "$body" | tail -1)
  body=$(echo "$body" | sed '$d')

  if [ "$http_code" = "200" ] && echo "$body" | grep -q "<nodes"; then
    return 0  # eisy found
  elif [ "$http_code" = "401" ]; then
    return 2  # auth failed
  fi
  return 1  # not eisy or unreachable
}

discover_eisy() {
  info "Discovering eisy at ${EISY_HOST}..."
  printf "\n"

  EISY_PROTO=""
  EISY_PORT=""
  local auth_failed=false

  # Try known ports first
  for port in "${KNOWN_PORTS[@]}"; do
    for proto in https http; do
      printf "  ${DIM}Probing ${proto}://${EISY_HOST}:${port}...${NC}"
      probe_port "$EISY_HOST" "$proto" "$port"
      local rc=$?
      if [ "$rc" -eq 0 ]; then
        printf "\r  ${GREEN}Found eisy at ${proto}://${EISY_HOST}:${port}${NC}       \n"
        EISY_PROTO="$proto"
        EISY_PORT="$port"
        return 0
      elif [ "$rc" -eq 2 ]; then
        printf "\r  ${YELLOW}Port ${port} (${proto}) — authentication failed${NC}       \n"
        auth_failed=true
      else
        printf "\r  ${DIM}Port ${port} (${proto}) — no response${NC}       \n"
      fi
    done
  done

  # Try extended ports
  info "Trying additional ports..."
  for port in "${EXTENDED_PORTS[@]}"; do
    for proto in https http; do
      printf "  ${DIM}Probing ${proto}://${EISY_HOST}:${port}...${NC}"
      if probe_port "$EISY_HOST" "$proto" "$port"; then
        printf "\r  ${GREEN}Found eisy at ${proto}://${EISY_HOST}:${port}${NC}       \n"
        EISY_PROTO="$proto"
        EISY_PORT="$port"
        return 0
      fi
      printf "\r  ${DIM}Port ${port} (${proto}) — no response${NC}       \n"
    done
  done

  # Discovery failed
  printf "\n"
  if [ "$auth_failed" = true ]; then
    error "Found eisy but authentication failed. Check your username and password."
  else
    error "Could not find eisy at ${EISY_HOST}."
    printf "\n"
    printf "  ${BOLD}Troubleshooting:${NC}\n"
    printf "  - Is your eisy powered on?\n"
    printf "  - Is it connected to the same network as this computer?\n"
    printf "  - Is the IP address correct? Check your router's DHCP table.\n"
  fi

  # Offer manual port entry
  printf "\n"
  printf "  Enter port manually (or press Enter to abort): "
  read -r manual_port < /dev/tty
  if [ -z "$manual_port" ]; then
    exit 2
  fi

  printf "  Protocol (https/http) [https]: "
  read -r manual_proto < /dev/tty
  manual_proto="${manual_proto:-https}"

  EISY_PROTO="$manual_proto"
  EISY_PORT="$manual_port"
  info "Using ${EISY_PROTO}://${EISY_HOST}:${EISY_PORT}"
}

# ─── Download Latest Release ─────────────────────────────────────────────────
download_release() {
  info "Fetching latest release from GitHub..."

  local api_url="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
  local api_response

  api_response=$(curl -fsSL "$api_url" 2>/dev/null) || {
    error "Failed to fetch release info from GitHub."
    error "Check your internet connection or visit:"
    error "  https://github.com/${REPO_OWNER}/${REPO_NAME}/releases"
    exit 3
  }

  # Extract tag name
  local tag
  tag=$(echo "$api_response" | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

  # Extract download URL for the zip
  local download_url
  download_url=$(echo "$api_response" | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*\.zip"' | head -1 | sed 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

  if [ -z "$download_url" ]; then
    error "No zip file found in the latest release."
    error "Visit: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases"
    exit 3
  fi

  info "Downloading Super eisy ${tag}..."

  WORK_DIR=$(mktemp -d)
  local zip_path="${WORK_DIR}/super-eisy.zip"

  curl -fSL --progress-bar -o "$zip_path" "$download_url" || {
    error "Download failed."
    exit 3
  }

  RELEASE_TAG="$tag"
  ZIP_PATH="$zip_path"
  success "Downloaded ${tag}"
}

# ─── Extract ──────────────────────────────────────────────────────────────────
extract_zip() {
  info "Extracting files..."

  EXTRACT_DIR="${WORK_DIR}/extracted"
  mkdir -p "$EXTRACT_DIR"

  if [ "$EXTRACT_CMD" = "unzip" ]; then
    unzip -qo "$ZIP_PATH" -d "$EXTRACT_DIR" || {
      error "Failed to extract zip file."
      exit 4
    }
  elif [ "$EXTRACT_CMD" = "python3" ]; then
    python3 -c "
import zipfile, sys
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
" "$ZIP_PATH" "$EXTRACT_DIR" || {
      error "Failed to extract zip file."
      exit 4
    }
  fi

  FILE_COUNT=$(find "$EXTRACT_DIR" -type f | wc -l | tr -d ' ')
  success "Extracted ${FILE_COUNT} files"
}

# ─── Upload to eisy ──────────────────────────────────────────────────────────
upload_files() {
  local base_url="${EISY_PROTO}://${EISY_HOST}:${EISY_PORT}"

  printf "\n${BOLD}Uploading to eisy...${NC}\n\n"

  local uploaded=0
  local failed=0
  local current=0
  local failed_files=""

  while IFS= read -r filepath; do
    local rel_path="${filepath#${EXTRACT_DIR}/}"
    current=$((current + 1))

    local file_size
    file_size=$(wc -c < "$filepath" | tr -d ' ')
    local size_display
    if [ "$file_size" -gt 1048576 ]; then
      size_display="$(( file_size / 1048576 )) MB"
    elif [ "$file_size" -gt 1024 ]; then
      size_display="$(( file_size / 1024 )) KB"
    else
      size_display="${file_size} B"
    fi

    printf "  [${current}/${FILE_COUNT}] ${rel_path} ${DIM}(${size_display})${NC} "

    local upload_url="${base_url}/file/upload/WEB/console/${rel_path}?load=n"

    local http_code
    http_code=$(curl -sk -X POST \
      -H "Authorization: Basic ${AUTH_HEADER}" \
      -H "Content-Type: application/octet-stream" \
      --data-binary "@${filepath}" \
      --connect-timeout 10 \
      --max-time 60 \
      -o /dev/null -w "%{http_code}" \
      "$upload_url" 2>/dev/null) || http_code="000"

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
      printf "${GREEN}OK${NC}\n"
      uploaded=$((uploaded + 1))
    else
      printf "${RED}FAILED (HTTP ${http_code})${NC}\n"
      failed=$((failed + 1))
      failed_files="${failed_files}\n    - ${rel_path}"
    fi
  done < <(find "$EXTRACT_DIR" -type f | sort)

  UPLOADED_COUNT=$uploaded
  FAILED_COUNT=$failed
  FAILED_FILES="$failed_files"
}

# ─── Summary ──────────────────────────────────────────────────────────────────
print_summary() {
  printf "\n"

  if [ "$FAILED_COUNT" -eq 0 ]; then
    printf "${GREEN}${BOLD}"
    printf "  ╔═══════════════════════════════════════╗\n"
    printf "  ║      Installation Complete!           ║\n"
    printf "  ╚═══════════════════════════════════════╝\n"
    printf "${NC}\n"
    success "Uploaded ${UPLOADED_COUNT}/${FILE_COUNT} files (Super eisy ${RELEASE_TAG})"
    printf "\n"
    printf "  ${BOLD}Open in your browser:${NC}\n"
    printf "  ${CYAN}${EISY_PROTO}://${EISY_HOST}:${EISY_PORT}/WEB/console/${NC}\n"
    printf "\n"
    printf "  ${DIM}To update later, run this same command again.${NC}\n"
    printf "\n"
  else
    printf "${YELLOW}${BOLD}"
    printf "  ╔═══════════════════════════════════════╗\n"
    printf "  ║    Installation Partially Complete    ║\n"
    printf "  ╚═══════════════════════════════════════╝\n"
    printf "${NC}\n"
    warn "Uploaded ${UPLOADED_COUNT}/${FILE_COUNT} files. ${FAILED_COUNT} failed:"
    printf "${FAILED_FILES}\n"
    printf "\n"
    printf "  ${DIM}Re-run this command to retry failed uploads.${NC}\n"
    printf "\n"
    exit 5
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  banner
  check_dependencies
  prompt_credentials
  printf "\n"
  discover_eisy
  printf "\n"
  download_release
  extract_zip
  upload_files
  print_summary
}

main
