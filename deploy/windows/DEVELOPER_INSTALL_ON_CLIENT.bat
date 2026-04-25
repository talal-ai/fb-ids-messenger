:: ═══════════════════════════════════════════════════════════════════════════
:: Developer Install Script — Run this on the CLIENT'S machine
:: The client does not need to do anything after this.
:: ═══════════════════════════════════════════════════════════════════════════
@echo off
setlocal

echo.
echo ============================================================
echo  FB IDs Messenger — Developer Setup on Client Machine
echo  (Run this as the developer during app delivery)
echo ============================================================
echo.
echo You need your ngrok auth token. Get it from:
echo   https://dashboard.ngrok.com/get-started/your-authtoken
echo.
set /p NGROK_TOKEN="Paste your ngrok authtoken here: "
if "%NGROK_TOKEN%"=="" ( echo ERROR: Token is required. & pause & exit /b 1 )

echo.
echo Installing ngrok...
winget install ngrok.ngrok --silent --accept-package-agreements --accept-source-agreements 2>nul
if errorlevel 1 (
    echo Trying direct download...
    PowerShell -Command "Invoke-WebRequest -Uri 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip' -OutFile '%TEMP%\ngrok.zip'; Expand-Archive '%TEMP%\ngrok.zip' -DestinationPath 'C:\ngrok' -Force"
    setx PATH "%PATH%;C:\ngrok" /M
)

echo Configuring ngrok auth token...
ngrok config add-authtoken %NGROK_TOKEN%

echo.
echo ============================================================
echo  Choose your permanent URL type:
echo ============================================================
echo.
echo  1. Use the FREE ngrok static domain (recommended)
echo     - You get ONE free permanent domain per ngrok account
echo     - Example: abc-xyz-123.ngrok-free.app
echo     - Get yours at: https://dashboard.ngrok.com/domains
echo.
echo  2. Let ngrok generate a random domain (changes on restart)
echo     - Only use for testing
echo.
set /p CHOICE="Enter 1 or 2: "

if "%CHOICE%"=="1" (
    echo.
    echo Go to https://dashboard.ngrok.com/domains and copy your static domain.
    set /p STATIC_DOMAIN="Paste your ngrok static domain (without https://): "
    set NGROK_ARGS=http --domain=%STATIC_DOMAIN% 3847
    set DISPLAY_URL=https://%STATIC_DOMAIN%
) else (
    set NGROK_ARGS=http 3847
    set DISPLAY_URL=(random - changes each restart)
)

echo.
echo Installing ngrok as a Windows Service (auto-starts on boot)...
ngrok service install --config "%USERPROFILE%\.config\ngrok\ngrok.yml" 2>nul
if errorlevel 1 (
    echo Registering via Task Scheduler instead...
    schtasks /create /tn "NgrokTunnel" /tr "ngrok %NGROK_ARGS%" /sc onlogon /ru "%USERNAME%" /f >nul 2>&1
    if errorlevel 1 (
        echo Registering via Registry startup instead...
        reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "NgrokTunnel" /t REG_SZ /d "ngrok %NGROK_ARGS%" /f >nul
    )
    echo Startup registered.
) else (
    echo ngrok service installed.
)

echo.
echo Starting ngrok now...
start "" ngrok %NGROK_ARGS%

echo.
echo Waiting for tunnel to start...
timeout /t 5 /nobreak >nul

echo.
echo ============================================================
echo  DONE
echo ============================================================
echo.
if "%CHOICE%"=="1" (
    echo  Permanent URL (never changes):
    echo    https://%STATIC_DOMAIN%
    echo.
    echo  IMPORTANT — Before you build and deliver the mobile app:
    echo  Open:  mobile\lib\client-config.ts
    echo  Set:   DEFAULT_SERVER_URL = 'https://%STATIC_DOMAIN%'
    echo  Set:   DEFAULT_API_TOKEN  = (from desktop app Settings)
    echo  Then:  Rebuild and deliver the mobile app
) else (
    echo  NOTE: Without a static domain the URL changes on restart.
    echo  Use option 1 (static domain) for client delivery.
)
echo.
pause
