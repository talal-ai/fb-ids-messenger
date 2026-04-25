# ─────────────────────────────────────────────────────────────────────────────
# Cloudflare Named Tunnel — Permanent HTTPS URL  (Windows Service)
#
# Gives you a stable URL like:  https://api.aimelectricpower.com
# that NEVER changes, survives reboots and internet reconnects.
#
# PREREQUISITES (do these BEFORE running this script):
#   1. Create a FREE Cloudflare account at https://cloudflare.com
#   2. Click "Add a site" → enter your domain (e.g. aimelectricpower.com)
#   3. Follow Cloudflare's steps — it will give you TWO nameservers like:
#        ada.ns.cloudflare.com
#        bob.ns.cloudflare.com
#   4. Go to your hosting control panel (cPanel / registrar) and replace
#      the existing nameservers with the Cloudflare ones above.
#   5. Wait up to 24 hours for the change to take effect (usually < 1 hour).
#
# HOW TO RUN (as Administrator, AFTER domain is on Cloudflare):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\install-named-tunnel.ps1 -Domain "aimelectricpower.com" -Subdomain "api"
# ─────────────────────────────────────────────────────────────────────────────

param(
    [Parameter(Mandatory)][string]$Domain,
    [string]$Subdomain   = "api",
    [string]$TunnelName  = "fb-ids-messenger",
    [int]$LocalPort      = 3847
)

$Hostname = "$Subdomain.$Domain"
$ConfigDir = "$env:USERPROFILE\.cloudflared"

function Step($n, $total, $msg) {
    Write-Host ""
    Write-Host "[$n/$total] $msg" -ForegroundColor Yellow
}
function Ok($msg)  { Write-Host "    OK: $msg" -ForegroundColor Green }
function Err($msg) { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=== FB IDs Messenger — Permanent Tunnel Setup ===" -ForegroundColor Cyan
Write-Host "    Permanent URL will be: https://$Hostname" -ForegroundColor White
Write-Host ""

# ── Step 1: Install cloudflared ───────────────────────────────────────────────
Step 1 7 "Installing cloudflared..."
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    Ok "cloudflared already installed: $(cloudflared --version 2>&1 | Select-Object -First 1)"
} else {
    winget install Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { Err "cloudflared install failed. Install manually from https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/" }
    Ok "cloudflared installed"
}

# ── Step 2: Authenticate ──────────────────────────────────────────────────────
Step 2 7 "Authenticating with Cloudflare (a browser window will open — log in to Cloudflare and click the domain)..."
cloudflared tunnel login
if ($LASTEXITCODE -ne 0) { Err "Login failed. Make sure your domain is added to your Cloudflare account first." }
Ok "Authenticated"

# ── Step 3: Create tunnel (skip if already exists) ────────────────────────────
Step 3 7 "Creating tunnel: $TunnelName"
$existing = cloudflared tunnel list 2>&1 | Select-String $TunnelName
if ($existing) {
    Ok "Tunnel '$TunnelName' already exists — reusing it"
} else {
    cloudflared tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) { Err "Failed to create tunnel." }
    Ok "Tunnel created"
}

# ── Step 4: Get tunnel ID and write config ────────────────────────────────────
Step 4 7 "Writing cloudflared config..."

# Parse tunnel ID from credentials files (more reliable than JSON parse of list output)
$credFile = Get-ChildItem "$ConfigDir\*.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'cert.pem' -and $_.Length -gt 10 } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $credFile) {
    # Fallback: try JSON list
    $listJson = cloudflared tunnel list --output json 2>&1
    try {
        $tunnels = $listJson | ConvertFrom-Json
        $TunnelId = ($tunnels | Where-Object { $_.name -eq $TunnelName }).id
    } catch { $TunnelId = $null }
} else {
    $TunnelId = ($credFile.BaseName)
}

if (-not $TunnelId) { Err "Could not determine tunnel ID. Run 'cloudflared tunnel list' manually and check the id column." }
Ok "Tunnel ID: $TunnelId"

$ConfigFile = "$ConfigDir\config.yml"
@"
tunnel: $TunnelId
credentials-file: $ConfigDir\$TunnelId.json

ingress:
  - hostname: $Hostname
    service: http://localhost:$LocalPort
  - service: http_status:404
"@ | Set-Content -Path $ConfigFile -Encoding UTF8
Ok "Config written to $ConfigFile"

# ── Step 5: Create DNS CNAME ──────────────────────────────────────────────────
Step 5 7 "Creating DNS record: $Hostname → Cloudflare tunnel..."
cloudflared tunnel route dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) {
    Write-Host "    WARN: DNS route command returned an error (may already exist — continuing)" -ForegroundColor DarkYellow
} else {
    Ok "DNS record created"
}

# ── Step 6: Install as Windows Service ───────────────────────────────────────
Step 6 7 "Installing cloudflared as a Windows Service (auto-starts on boot)..."
$svc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "    WARN: Cloudflared service already installed — removing and reinstalling" -ForegroundColor DarkYellow
    Stop-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue
    cloudflared service uninstall 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}
cloudflared service install
if ($LASTEXITCODE -ne 0) { Err "Failed to install Windows service. Make sure you are running as Administrator." }
Ok "Windows Service installed"

# ── Step 7: Start the service ─────────────────────────────────────────────────
Step 7 7 "Starting the Cloudflared service..."
Start-Sleep -Seconds 2
Start-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$svcState = (Get-Service -Name "Cloudflared").Status
if ($svcState -eq "Running") {
    Ok "Service is running"
} else {
    Write-Host "    WARN: Service status is '$svcState'. Check: Get-EventLog -LogName Application -Source cloudflared -Newest 10" -ForegroundColor DarkYellow
}

# ── Final summary ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " SETUP COMPLETE" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host " Permanent API URL (never changes):" -ForegroundColor White
Write-Host "   https://$Hostname" -ForegroundColor Cyan
Write-Host ""
Write-Host " Enter these values in the mobile app Settings:" -ForegroundColor White
Write-Host "   Server URL  :  https://$Hostname" -ForegroundColor Cyan
Write-Host "   API Token   :  (from the desktop app Settings > API Token)" -ForegroundColor Gray
Write-Host ""
Write-Host " The tunnel auto-starts when this PC boots." -ForegroundColor Gray
Write-Host " Check tunnel status:  Get-Service Cloudflared" -ForegroundColor Gray
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
