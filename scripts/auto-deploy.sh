#!/usr/bin/env bash
#
# LGL Uplink Portal — Server Auto-Deployer
#
# Pulls the latest Docker image from GHCR and restarts the portal via Docker Compose.
# Can be triggered:
#   - Manually:          sudo ./auto-deploy.sh
#   - By systemd timer:  sudo ./auto-deploy.sh --install-timer
#   - Via webhook:       sudo ./auto-deploy.sh --webhook-server
#
# Configuration (set in /etc/lgl-portal/deploy.conf):
#   GITHUB_TOKEN=ghp_...         # PAT with read:packages scope
#   REGISTRY=ghcr.io
#   IMAGE=ionglue/lgl-uplink-portal
#   COMPOSE_FILE=/opt/lgl-portal/docker-compose.yml
#   WEBHOOK_SECRET=<random>      # Required when using --webhook-server
#   WEBHOOK_PORT=9000

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────
REGISTRY="${REGISTRY:-ghcr.io}"
IMAGE_OWNER="${IMAGE_OWNER:-ionglue}"
IMAGE_NAME="${IMAGE_NAME:-lgl-uplink-portal}"
IMAGE="${REGISTRY}/${IMAGE_OWNER}/${IMAGE_NAME}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/lgl-portal/docker-compose.yml}"
SERVICE_NAME="${SERVICE_NAME:-uplink-portal}"
CONFIG_DIR="${CONFIG_DIR:-/etc/lgl-portal}"
DEPLOY_CONF="${CONFIG_DIR}/deploy.conf"
WEBHOOK_PORT="${WEBHOOK_PORT:-9000}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"
LOG_FILE="/var/log/lgl-portal-deploy.log"

# ── Load config ───────────────────────────────────────────────────
if [[ -f "${DEPLOY_CONF}" ]]; then
    # shellcheck source=/dev/null
    source "${DEPLOY_CONF}"
fi

# ── Helpers ───────────────────────────────────────────────────────
log()   { echo "[$(date -Iseconds)] $*" | tee -a "${LOG_FILE}" 2>/dev/null || echo "$*"; }
info()  { log "[INFO]  $*"; }
ok()    { log "[OK]    $*"; }
warn()  { log "[WARN]  $*"; }
fail()  { log "[FAIL]  $*"; exit 1; }

# ── Docker login to GHCR ─────────────────────────────────────────
docker_login() {
    if [[ -z "${GITHUB_TOKEN:-}" ]]; then
        warn "GITHUB_TOKEN not set — skipping docker login (image must be public)"
        return
    fi
    echo "${GITHUB_TOKEN}" | docker login "${REGISTRY}" -u github-actions --password-stdin
    ok "Logged in to ${REGISTRY}"
}

# ── Pull latest image ─────────────────────────────────────────────
pull_image() {
    info "Pulling ${IMAGE}:latest..."
    docker pull "${IMAGE}:latest"
    ok "Pull complete"
}

# ── Redeploy via Docker Compose ───────────────────────────────────
redeploy() {
    if [[ ! -f "${COMPOSE_FILE}" ]]; then
        fail "Compose file not found: ${COMPOSE_FILE}"
    fi

    info "Redeploying ${SERVICE_NAME} via Docker Compose..."
    local compose_dir
    compose_dir=$(dirname "${COMPOSE_FILE}")

    docker compose -f "${COMPOSE_FILE}" pull "${SERVICE_NAME}" 2>/dev/null || true
    docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate "${SERVICE_NAME}"
    ok "Redeployed ${SERVICE_NAME}"

    # Prune dangling images to save disk
    docker image prune -f --filter "label=org.opencontainers.image.source" 2>/dev/null || \
    docker image prune -f 2>/dev/null || true
}

# ── Install as systemd timer ──────────────────────────────────────
install_timer() {
    info "Installing portal auto-deploy timer..."

    local deploy_path="/usr/local/bin/portal-auto-deploy"
    cp -f "${BASH_SOURCE[0]}" "${deploy_path}"
    chmod 755 "${deploy_path}"

    cat > /etc/systemd/system/portal-deploy.service << 'UNIT'
[Unit]
Description=LGL Uplink Portal Auto-Deploy
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-/etc/lgl-portal/deploy.conf
ExecStart=/usr/local/bin/portal-auto-deploy --run
StandardOutput=journal
StandardError=journal
SyslogIdentifier=portal-deploy
UNIT

    cat > /etc/systemd/system/portal-deploy.timer << 'UNIT'
[Unit]
Description=LGL Uplink Portal Auto-Deploy Timer
Requires=portal-deploy.service

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
AccuracySec=30s
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
UNIT

    systemctl daemon-reload
    systemctl enable --now portal-deploy.timer
    ok "Auto-deploy timer enabled (runs every 5 minutes)"
    info "  Run now: systemctl start portal-deploy.service"
    info "  Logs:    journalctl -u portal-deploy -f"
}

# ── Simple webhook listener ───────────────────────────────────────
# Listens on WEBHOOK_PORT for POST /deploy from GitHub Actions CD.
# Verifies HMAC-SHA256 signature if WEBHOOK_SECRET is set.
webhook_server() {
    if ! command -v nc &>/dev/null && ! command -v ncat &>/dev/null; then
        fail "Neither nc nor ncat found — install netcat: apt install netcat-openbsd"
    fi

    local nc_cmd="nc"
    command -v ncat &>/dev/null && nc_cmd="ncat"

    info "Webhook server listening on port ${WEBHOOK_PORT}..."

    while true; do
        local request
        request=$(${nc_cmd} -l -p "${WEBHOOK_PORT}" -q 1 2>/dev/null || \
                  ${nc_cmd} -l "${WEBHOOK_PORT}" 2>/dev/null || true)

        local method path
        method=$(echo "$request" | head -1 | awk '{print $1}')
        path=$(echo "$request" | head -1 | awk '{print $2}')

        if [[ "$method" != "POST" ]] || [[ "$path" != "/deploy" ]]; then
            continue
        fi

        # Extract signature header
        local sig
        sig=$(echo "$request" | grep -i "X-Deploy-Signature:" | awk '{print $2}' | tr -d '\r' || echo "")

        # Extract body (after blank line)
        local body
        body=$(echo "$request" | awk '/^\r?$/{found=1; next} found{print}' | tr -d '\r')

        # Verify signature if secret is set
        if [[ -n "${WEBHOOK_SECRET}" ]]; then
            local expected
            expected="sha256=$(echo -n "${body}" | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}" | awk '{print $2}')"
            if [[ "$sig" != "$expected" ]]; then
                warn "Signature mismatch — ignoring deploy request"
                continue
            fi
        fi

        info "Deploy webhook received — triggering redeploy"
        docker_login
        pull_image
        redeploy
    done
}

# ── Install webhook as systemd service ────────────────────────────
install_webhook_service() {
    info "Installing webhook listener service..."

    local deploy_path="/usr/local/bin/portal-auto-deploy"
    cp -f "${BASH_SOURCE[0]}" "${deploy_path}"
    chmod 755 "${deploy_path}"

    cat > /etc/systemd/system/portal-webhook.service << 'UNIT'
[Unit]
Description=LGL Uplink Portal Webhook Deploy Listener
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-/etc/lgl-portal/deploy.conf
ExecStart=/usr/local/bin/portal-auto-deploy --webhook-server
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=portal-webhook
UNIT

    systemctl daemon-reload
    systemctl enable --now portal-webhook.service
    ok "Webhook service enabled on port ${WEBHOOK_PORT}"
    info "  Set DEPLOY_WEBHOOK_URL=http://YOUR_SERVER_IP:${WEBHOOK_PORT}/deploy in GitHub secrets"
    info "  Set DEPLOY_WEBHOOK_SECRET=<same as WEBHOOK_SECRET in deploy.conf> in GitHub secrets"
    info "  Logs: journalctl -u portal-webhook -f"
}

# ── Write default config ──────────────────────────────────────────
write_config() {
    mkdir -p "${CONFIG_DIR}"
    if [[ -f "${DEPLOY_CONF}" ]]; then
        ok "Config already exists at ${DEPLOY_CONF}"
        return
    fi

    cat > "${DEPLOY_CONF}" << CONF
# LGL Uplink Portal — Deploy Configuration
# Generated on $(date -Iseconds)

REGISTRY=ghcr.io
IMAGE_OWNER=ionglue
IMAGE_NAME=lgl-uplink-portal
COMPOSE_FILE=/opt/lgl-portal/docker-compose.yml
SERVICE_NAME=uplink-portal

# GitHub PAT with read:packages scope (for pulling private GHCR images).
# Generate at: https://github.com/settings/tokens
GITHUB_TOKEN=

# Webhook authentication secret (generate with: openssl rand -hex 32)
# Must match DEPLOY_WEBHOOK_SECRET in GitHub Actions secrets.
WEBHOOK_SECRET=

WEBHOOK_PORT=9000
CONF
    chmod 600 "${DEPLOY_CONF}"
    ok "Config written to ${DEPLOY_CONF} — edit it before proceeding"
}

# ── Main ──────────────────────────────────────────────────────────
usage() {
    echo "Usage: $0 [--run | --install-timer | --install-webhook | --help]"
    echo ""
    echo "  --run               Pull latest image and redeploy (default)"
    echo "  --install-timer     Install as a systemd timer (every 5 minutes)"
    echo "  --install-webhook   Install as a webhook listener service"
    echo "  --webhook-server    Run webhook listener in foreground (used by systemd)"
    echo "  --help              Show this help"
    echo ""
    echo "Config: ${DEPLOY_CONF}"
}

main() {
    local mode="run"

    for arg in "$@"; do
        case "$arg" in
            --run) mode="run" ;;
            --install-timer) mode="install-timer" ;;
            --install-webhook) mode="install-webhook" ;;
            --webhook-server) mode="webhook-server" ;;
            --help|-h) usage; exit 0 ;;
        esac
    done

    case "$mode" in
        run)
            docker_login
            pull_image
            redeploy
            ;;
        install-timer)
            [[ $EUID -eq 0 ]] || fail "Must run as root"
            write_config
            install_timer
            docker_login
            pull_image
            redeploy
            ;;
        install-webhook)
            [[ $EUID -eq 0 ]] || fail "Must run as root"
            write_config
            install_webhook_service
            ;;
        webhook-server)
            webhook_server
            ;;
    esac
}

main "$@"
