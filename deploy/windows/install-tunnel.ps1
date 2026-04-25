# ─────────────────────────────────────────────────────────────────────────────
# Cloudflare Tunnel — Windows Setup Script
#
# Makes the control-plane API (port 3847) accessible globally via HTTPS
# so the mobile app can connect from anywhere on the planet.
#
# HOW TO RUN (as Administrator):
#   1. Open PowerShell as Administrator
#   2. cd to this folder
#   3. Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   4. .\install-tunnel.ps1
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$TunnelName = "fb-ids-messenger",
    [int]$LocalPort     = 3847
)

Write-Host ""
Write-Host "=== FB IDs Messenger — Cloudflare Tunnel Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Install cloudflared ───────────────────────────────────────────────
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "[1/4] Installing cloudflared via winget..." -ForegroundColor Yellow
    winget install Cloudflare.cloudflared --silent
    # Reload PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
} else {
    Write-Host "[1/4] cloudflared already installed: $(cloudflared --version)" -ForegroundColor Green
}

# ── Step 2: Quick test tunnel (no account needed) ─────────────────────────────
Write-Host ""
Write-Host "[2/4] Starting a quick test tunnel to port $LocalPort..." -ForegroundColor Yellow
Write-Host "      Press Ctrl+C to stop the test once you confirm the URL works." -ForegroundColor Gray
Write-Host ""
Write-Host "      IMPORTANT: Copy the https://*.trycloudflare.com URL shown below." -ForegroundColor White
Write-Host "      Enter that URL in the mobile app Settings > Server URL." -ForegroundColor White
Write-Host ""

# Run in foreground so the user can see the URL
cloudflared tunnel --url "http://localhost:$LocalPort"

Write-Host ""
Write-Host "[3/4] NOTE: The free trycloudflare.com URL changes every restart." -ForegroundColor Yellow
Write-Host "      For a PERMANENT URL, log in to Cloudflare and run the named tunnel setup below."
Write-Host ""
Write-Host "[4/4] To install as a permanent Windows Service (auto-starts with PC):" -ForegroundColor Yellow
Write-Host "      See deploy\windows\install-named-tunnel.ps1" -ForegroundColor Gray
