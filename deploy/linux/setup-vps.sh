#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Linux VPS Setup — FB IDs Messenger Headless Server
#
# Installs Node.js, Chromium, PM2, and sets up the headless server
# as a system service that auto-starts on boot.
#
# Tested on: Ubuntu 22.04 / 24.04
#
# USAGE:
#   1. Copy the entire project to your VPS:
#        rsync -avz --exclude node_modules . user@your-vps-ip:~/fb-ids-messenger/
#   2. SSH into the VPS and run:
#        sudo bash deploy/linux/setup-vps.sh
#   3. Configure environment variables:
#        sudo nano /etc/fb-ids-messenger.env
#   4. Start the service:
#        sudo systemctl start fb-ids-messenger
# ─────────────────────────────────────────────────────────────────────────────

set -e

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
SERVICE_NAME="fb-ids-messenger"
ENV_FILE="/etc/${SERVICE_NAME}.env"
DATA_DIR="/var/lib/${SERVICE_NAME}"

echo ""
echo "=== FB IDs Messenger — VPS Setup ==="
echo "    App dir    : $APP_DIR"
echo "    Service user: $SERVICE_USER"
echo "    Data dir   : $DATA_DIR"
echo ""

# ── Install Node.js 20 LTS ────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
    echo "[1/6] Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/6] Node.js already installed: $(node --version)"
fi

# ── Install Chromium (for Playwright) ────────────────────────────────────────
echo "[2/6] Installing Chromium and dependencies..."
apt-get install -y \
    chromium-browser \
    libatk-bridge2.0-0 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 \
    libcairo2 libatspi2.0-0 libwayland-client0 --no-install-recommends 2>/dev/null || true

# ── Install PM2 (process manager) ────────────────────────────────────────────
echo "[3/6] Installing PM2..."
npm install -g pm2

# ── Install project dependencies ─────────────────────────────────────────────
echo "[4/6] Installing project npm dependencies..."
cd "$APP_DIR"
npm install --omit=dev 2>/dev/null || npm install

# Install Playwright browsers
cd "$APP_DIR/node_modules/.bin" 2>/dev/null || cd "$APP_DIR"
npx playwright install chromium 2>/dev/null || true

# ── Create data directory ─────────────────────────────────────────────────────
echo "[5/6] Creating data directory: $DATA_DIR"
mkdir -p "$DATA_DIR"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR"

# ── Create environment file ───────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" << EOF
# FB IDs Messenger — Server Configuration
# Edit this file and then: sudo systemctl restart fb-ids-messenger

# REQUIRED — Bearer token the mobile app uses (choose any secure string)
CONTROL_PLANE_TOKEN=CHANGE_THIS_TO_A_SECURE_TOKEN

# Where to store the SQLite database and browser profiles
FB_DATA_DIR=${DATA_DIR}

# API port (default 3847 — open this in your VPS firewall)
CONTROL_PLANE_PORT=3847

# Optional Telegram alerts
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
EOF
    chmod 600 "$ENV_FILE"
    chown "$SERVICE_USER":"$SERVICE_USER" "$ENV_FILE"
    echo "    Created $ENV_FILE — EDIT THIS FILE before starting the service!"
else
    echo "    $ENV_FILE already exists — skipping creation"
fi

# ── Create systemd service ────────────────────────────────────────────────────
echo "[6/6] Creating systemd service: $SERVICE_NAME"

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=FB IDs Messenger Headless Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/headless/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Allow Chromium to run in --no-sandbox mode
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "NEXT STEPS:"
echo "  1. Edit the config:    sudo nano $ENV_FILE"
echo "  2. Set CONTROL_PLANE_TOKEN to a secure random string"
echo "  3. Start the service:  sudo systemctl start $SERVICE_NAME"
echo "  4. Check status:       sudo systemctl status $SERVICE_NAME"
echo "  5. View logs:          sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo "  6. Open firewall port: sudo ufw allow $SERVICE_NAME_PORT  (or use nginx+SSL below)"
echo ""
echo "  7. For HTTPS (recommended), install nginx:"
echo "     sudo apt install nginx certbot python3-certbot-nginx"
echo "     sudo certbot --nginx -d your-domain.com"
echo "     Then proxy: location / { proxy_pass http://localhost:3847; }"
echo ""
