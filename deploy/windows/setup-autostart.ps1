# ─────────────────────────────────────────────────────────────────────────────
# Desktop App Auto-Start Setup
#
# Adds the FB IDs Messenger desktop app to Windows startup so it launches
# automatically when the PC boots — without the user doing anything.
#
# HOW TO RUN (as the USER who will run the app, NOT as Administrator):
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\setup-autostart.ps1 -AppPath "C:\Path\To\FB IDs Messenger.exe"
#
# To find the app path after installation:
#   Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter "*.exe" |
#     Where-Object { $_.Name -like "*Messenger*" -or $_.Name -like "*FB*" }
# ─────────────────────────────────────────────────────────────────────────────

param(
    [string]$AppPath = ""
)

Write-Host ""
Write-Host "=== FB IDs Messenger — Auto-Start Setup ===" -ForegroundColor Cyan
Write-Host ""

# ── Find the app exe if not provided ─────────────────────────────────────────
if (-not $AppPath) {
    $candidates = @(
        (Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*Messenger*" -or $_.Name -like "*FB*" -or $_.Name -like "*Multi*" } |
            Select-Object -First 1 -ExpandProperty FullName),
        (Get-ChildItem "C:\Program Files\*" -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*Messenger*" -or $_.Name -like "*FB*" -or $_.Name -like "*Multi*" } |
            Select-Object -First 1 -ExpandProperty FullName)
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -gt 0) {
        $AppPath = $candidates[0]
        Write-Host "    Auto-detected app: $AppPath" -ForegroundColor Gray
    } else {
        Write-Host "    Could not auto-detect the app. Please provide the path:" -ForegroundColor Yellow
        Write-Host "    .\setup-autostart.ps1 -AppPath ""C:\Path\To\YourApp.exe""" -ForegroundColor Gray
        exit 1
    }
}

if (-not (Test-Path $AppPath)) {
    Write-Host "    ERROR: App not found at: $AppPath" -ForegroundColor Red
    exit 1
}

# ── Add to Windows startup via registry (current user, no admin needed) ───────
$RegKey  = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$AppName = "FBIdsMessenger"

Set-ItemProperty -Path $RegKey -Name $AppName -Value "`"$AppPath`"" -Force
$check = Get-ItemProperty -Path $RegKey -Name $AppName -ErrorAction SilentlyContinue
if ($check) {
    Write-Host "    OK: App will auto-start on login" -ForegroundColor Green
    Write-Host "    Path: $AppPath" -ForegroundColor Gray
} else {
    Write-Host "    ERROR: Failed to add registry startup entry." -ForegroundColor Red
    exit 1
}

# ── Also verify Cloudflared service is set to auto-start ─────────────────────
$cfSvc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if ($cfSvc) {
    if ($cfSvc.StartType -ne "Automatic") {
        Set-Service -Name "Cloudflared" -StartupType Automatic
        Write-Host "    OK: Cloudflared service set to Automatic startup" -ForegroundColor Green
    } else {
        Write-Host "    OK: Cloudflared service already set to Automatic startup" -ForegroundColor Green
    }
} else {
    Write-Host "    NOTE: Cloudflared service not found — run install-named-tunnel.ps1 first." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host " Auto-start configured." -ForegroundColor Green
Write-Host " When this PC restarts:" -ForegroundColor White
Write-Host "   1. Cloudflared tunnel starts automatically (Windows Service)" -ForegroundColor Gray
Write-Host "   2. FB IDs Messenger desktop app starts automatically (registry)" -ForegroundColor Gray
Write-Host "   3. Mobile app connects — no manual steps needed." -ForegroundColor Gray
Write-Host "════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── Remove from auto-start instructions ──────────────────────────────────────
Write-Host " To REMOVE auto-start later, run:" -ForegroundColor DarkGray
Write-Host "   Remove-ItemProperty -Path HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name FBIdsMessenger" -ForegroundColor DarkGray
Write-Host ""
