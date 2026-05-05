# Windows PowerShell version of install-apk.sh.
# Usage:  .\scripts\install-apk.ps1 [path\to\file.apk]
# Default APK: .\fbmgr-preview.apk

$ErrorActionPreference = "Stop"

$ApkPath = if ($args.Count -gt 0) { $args[0] } else { ".\fbmgr-preview.apk" }
$AppPkg  = "com.fbmanager.mobile"

# Locate adb
$AdbCandidates = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ANDROID_HOME\platform-tools\adb.exe",
    "C:\Android\Sdk\platform-tools\adb.exe"
)
$Adb = $AdbCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Adb) {
    Write-Host "[install-apk] adb.exe not found. Install Android Studio + SDK Platform-Tools first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ApkPath)) {
    Write-Host "[install-apk] APK not found: $ApkPath" -ForegroundColor Red
    Write-Host "  Download with: Invoke-WebRequest -Uri <EAS-build-URL> -OutFile fbmgr-preview.apk"
    exit 1
}

# Check device connection
$Devices = & $Adb devices | Select-String "device$" | Where-Object { $_ -notmatch "List of" }
if ($Devices.Count -eq 0) {
    Write-Host "[install-apk] No Android device connected via USB." -ForegroundColor Yellow
    Write-Host "  1. Connect phone via USB"
    Write-Host "  2. On phone: Settings -> About phone -> tap Build number 7 times -> enable Developer Options"
    Write-Host "  3. On phone: Developer Options -> enable USB debugging"
    Write-Host "  4. Plug in cable, accept the 'Allow USB debugging?' prompt on the phone"
    Write-Host "  5. Re-run this script."
    exit 1
}

Write-Host "[install-apk] Installing $ApkPath..." -ForegroundColor Cyan
& $Adb install -r $ApkPath

Write-Host ""
Write-Host "[install-apk] Installed. Launching app..." -ForegroundColor Green
& $Adb shell monkey -p $AppPkg -c android.intent.category.LAUNCHER 1 | Out-Null

Write-Host ""
Write-Host "[install-apk] Tailing push-related log lines (Ctrl-C to stop):" -ForegroundColor Cyan
Write-Host "  Look for: '[Push] Expo push token: ExponentPushToken[...]'"
Write-Host "  And:      '[Push] Token registered with backend'"
Write-Host "  Or any:   '[Push] Firebase is not initialized' / '[Push] Permission not granted'"
Write-Host "-----------------------------------------------------------------"

& $Adb logcat -c
& $Adb logcat ReactNativeJS:V "*:S" | Select-String -Pattern "push|notif|fcm|firebase|token"
