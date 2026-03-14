#!/usr/bin/env bash
#
# LGL Uplink Portal — Local Auto-Update
#
# Pulls latest from git, rebuilds if changed, and restarts services.
# Install as a launchd agent: ./local-update.sh --install
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-/Users/bartsnakenborg/LGL-Ingest-1}"
LOG_FILE="${REPO_DIR}/logs/auto-update.log"
PLIST_LABEL="com.lgl.uplink-portal-update"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
INTERVAL="${INTERVAL:-300}"  # 5 minutes

mkdir -p "$(dirname "${LOG_FILE}")"

log()  { echo "[$(date -Iseconds)] $*" | tee -a "${LOG_FILE}"; }
info() { log "[INFO]  $*"; }
ok()   { log "[OK]    $*"; }
fail() { log "[FAIL]  $*"; exit 1; }

update() {
    cd "${REPO_DIR}" || fail "Cannot cd to ${REPO_DIR}"

    local before
    before=$(git rev-parse HEAD)

    git fetch origin main --quiet || fail "git fetch failed"

    local after
    after=$(git rev-parse origin/main)

    if [[ "$before" == "$after" ]]; then
        info "Already up to date (${before:0:7})"
        return 0
    fi

    info "Updating ${before:0:7} → ${after:0:7}"
    git pull --ff-only origin main || fail "git pull failed"

    info "Rebuilding services..."
    docker compose up -d --build uplink-portal 2>&1 | tee -a "${LOG_FILE}"
    ok "Update complete (${after:0:7})"
}

install_launchd() {
    local script_path
    script_path=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")

    mkdir -p "$(dirname "${PLIST_PATH}")"

    cat > "${PLIST_PATH}" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${script_path}</string>
        <string>--run</string>
    </array>
    <key>StartInterval</key>
    <integer>${INTERVAL}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
    <key>WorkingDirectory</key>
    <string>${REPO_DIR}</string>
</dict>
</plist>
PLIST

    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
    launchctl load "${PLIST_PATH}"
    ok "Auto-update installed — runs every ${INTERVAL}s"
    info "  Logs: tail -f ${LOG_FILE}"
    info "  Stop: launchctl unload ${PLIST_PATH}"
}

uninstall_launchd() {
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
    rm -f "${PLIST_PATH}"
    ok "Auto-update uninstalled"
}

case "${1:-}" in
    --run)     update ;;
    --install) install_launchd ;;
    --uninstall) uninstall_launchd ;;
    *)
        echo "Usage: $0 [--run | --install | --uninstall]"
        echo ""
        echo "  --run         Pull & rebuild if changed"
        echo "  --install     Install as launchd agent (every 5 min)"
        echo "  --uninstall   Remove launchd agent"
        ;;
esac
