:: ═══════════════════════════════════════════════════════════════════════════
:: FB IDs Messenger — Client First-Time Setup
:: Run this file as Administrator on the client's Windows machine
:: ═══════════════════════════════════════════════════════════════════════════
@echo off
echo.
echo ============================================================
echo  FB IDs Messenger — First-Time Setup
echo ============================================================
echo.
echo This wizard will:
echo   1. Check your prerequisites
echo   2. Guide you through Cloudflare setup (one time only)
echo   3. Install the permanent tunnel as a Windows Service
echo   4. Configure the desktop app to auto-start on boot
echo.
echo ============================================================
echo  BEFORE YOU CONTINUE — You must have done this first:
echo ============================================================
echo.
echo   A) Created a FREE Cloudflare account at https://cloudflare.com
echo   B) Added your domain (e.g. aimelectricpower.com) to Cloudflare
echo   C) Updated your domain's nameservers to Cloudflare's servers
echo      (Go to your hosting panel and replace nameservers)
echo   D) Waited at least 1 hour for DNS to update
echo.
set /p READY="Have you done all of the above? (y/n): "
if /i NOT "%READY%"=="y" (
    echo.
    echo Please complete the Cloudflare steps first, then run this again.
    pause
    exit /b 1
)

echo.
set /p DOMAIN="Enter your domain (e.g. aimelectricpower.com): "
set /p SUBDOMAIN="Enter subdomain for the API (press Enter for 'api'): "
if "%SUBDOMAIN%"=="" set SUBDOMAIN=api

echo.
echo ============================================================
echo  Step 1 of 3: Setting up permanent Cloudflare tunnel...
echo ============================================================
echo.
PowerShell -ExecutionPolicy Bypass -File "%~dp0install-named-tunnel.ps1" -Domain "%DOMAIN%" -Subdomain "%SUBDOMAIN%"

echo.
echo ============================================================
echo  Step 2 of 3: Configuring desktop app to auto-start...
echo ============================================================
echo.
PowerShell -ExecutionPolicy Bypass -File "%~dp0setup-autostart.ps1"

echo.
echo ============================================================
echo  Step 3 of 3: Testing the connection...
echo ============================================================
echo.
set URL=https://%SUBDOMAIN%.%DOMAIN%/health
echo Testing: %URL%
PowerShell -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing '%URL%' -TimeoutSec 15; Write-Host 'SUCCESS: ' $r.Content -ForegroundColor Green } catch { Write-Host 'FAILED: ' $_.Exception.Message -ForegroundColor Red; Write-Host 'NOTE: DNS may take up to 24h to propagate. Try again later.' -ForegroundColor Yellow }"

echo.
echo ============================================================
echo  SETUP COMPLETE
echo ============================================================
echo.
echo  Your permanent API URL is:
echo    https://%SUBDOMAIN%.%DOMAIN%
echo.
echo  Enter these in your mobile app Settings:
echo    Server URL : https://%SUBDOMAIN%.%DOMAIN%
echo    API Token  : (shown in desktop app Settings - API Token field)
echo.
echo  This URL will NEVER change. Even if the PC restarts,
echo  the tunnel and the app start automatically.
echo.
pause
