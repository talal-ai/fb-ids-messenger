# Manual tunnel test — proves the permanent URL works against your REAL desktop backend.
# No build / no npm install needed. Just open your installed "Multi FB Manager" app first.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\test-tunnel.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\test-tunnel.ps1 -Token "YOUR_DESKTOP_CONTROL_PLANE_TOKEN"

param([string]$Token = "")

$ErrorActionPreference = "Stop"
$root   = Split-Path -Parent $PSScriptRoot
$frpc   = Join-Path $root "resources\frpc\frpc.exe"
$config = Join-Path $root "scripts\frpc-test.toml"
$public = "https://multi-messenger.gadgetronics.pk"

Write-Host "=== 1. Is your desktop backend running on :3847? ===" -ForegroundColor Cyan
$listening = Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Write-Host "  ✗ Nothing on :3847. OPEN your 'Multi FB Manager' desktop app first, then re-run this." -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Backend is listening on :3847" -ForegroundColor Green

Write-Host "=== 2. Starting the tunnel (frpc) ... ===" -ForegroundColor Cyan
$proc = Start-Process -FilePath $frpc -ArgumentList "-c", $config -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4

try {
    Write-Host "=== 3. Testing PUBLIC health (no auth) through the permanent URL ===" -ForegroundColor Cyan
    try {
        $h = Invoke-WebRequest -Uri "$public/health" -UseBasicParsing -TimeoutSec 15
        Write-Host "  ✓ $public/health -> $($h.Content)" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ health failed: $($_.Exception.Message)" -ForegroundColor Red
    }

    if ($Token) {
        Write-Host "=== 4. Testing your REAL accounts (with token) ===" -ForegroundColor Cyan
        try {
            $a = Invoke-WebRequest -Uri "$public/v1/accounts" -Headers @{ Authorization = "Bearer $Token" } -UseBasicParsing -TimeoutSec 15
            Write-Host "  ✓ accounts -> $($a.Content)" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ accounts failed (check token matches desktop Settings): $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "=== 4. (skipped) Pass -Token 'your-control-plane-token' to test /v1/accounts ===" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "Tunnel is LIVE. Now try it on your PHONE:" -ForegroundColor Yellow
    Write-Host "  - Open $public/health in your phone browser -> should show {`"ok`":true}" -ForegroundColor Yellow
    Write-Host "  - Or in the mobile app Settings, set Server URL = $public and your token." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press ENTER to STOP the tunnel..." -ForegroundColor Cyan
    [void][System.Console]::ReadLine()
}
finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Write-Host "Tunnel stopped." -ForegroundColor DarkGray
}
