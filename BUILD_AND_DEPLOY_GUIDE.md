# BUILD & DEPLOYMENT GUIDE

## Current Status

✅ **Frontend built and ready** 
- Location: `C:\my-data\fb-ids-messenger\dist\`
- Contains: `index.html`, `assets/` (CSS, JS, SVG)
- Size: ~270 KB

⏳ **Mobile app building on EAS servers** (background)
- Build ID: `afd4ce2e-ea43-4832-9d38-d8382c817416`
- Track progress: https://expo.dev/accounts/veo3/projects/multi-fb-manager/builds/afd4ce2e-ea43-4832-9d38-d8382c817416
- Profile: Android APK (preview)
- Will complete automatically

❌ **Desktop app packaging blocked** (temporary, easy fix)
- Issue: Native `better-sqlite3` module locked by file system
- Workaround below ↓

---

## IMMEDIATE: Desktop App Workaround

The desktop app frontend is built. To complete the Windows installer, you have two options:

### Option A: Quick Manual Package (2 minutes)
Use the existing built frontend + electron binaries without electron-builder:

```powershell
cd c:\my-data\fb-ids-messenger

# Copy the built frontend
Copy-Item -Path "dist/*" -Destination "electron-dist/" -Recurse -Force

# Create a simple portable executable
# (Skip full installer, just run: npm start in production mode)
# Then zip the entire folder as a distributable
```

### Option B: Proper Installer (Recommended)
Restart your computer first (clears all file locks), then:

```powershell
cd c:\my-data\fb-ids-messenger
npm run package:win   # Should work perfectly after restart
```

This creates: `C:\my-data\fb-ids-messenger\dist\Multi FB Manager Setup X.X.X.exe`

---

## Mobile App Build Status

### Android APK
- **Status**: Building on EAS servers (in background)
- **Profile**: Preview (APK format, ready to install on any phone)
- **Auto-config**: ✅ Includes your ngrok domain + API token baked in
- **Download location**: Will appear at https://expo.dev/accounts/veo3/projects/multi-fb-manager/builds/afd4ce2e-ea43-4832-9d38-d8382c817416
- **When ready**: You'll see a green "Download" button
- **Install on Android**: `adb install app-preview.apk` or open APK file directly on phone

### iOS Build (Optional)
To build for iPhone/iPad:

```powershell
cd c:\my-data\fb-ids-messenger\mobile
eas build --platform ios --profile preview
```

Requires:
- Apple Developer account ($99/year)
- Mac with Xcode (cannot build on Windows)
- Takes ~20-30 minutes

---

## Files Ready for Delivery

### ✅ Desktop App
- **Frontend**: `C:\my-data\fb-ids-messenger\dist\`
- **Main entry**: `C:\my-data\fb-ids-messenger\desktop\main.js`
- **DB**: Auto-creates at `%APPDATA%\Multi FB Manager\messenger.db`
- **Config**: Pre-configured to connect to `https://french-handled-perkiness.ngrok-free.app`

### ✅ Mobile App (Android)
- **APK**: Download from EAS build dashboard when ready
- **Pre-configured**: Server URL + API token baked in
- **No Settings needed**: Opens and works immediately
- **First launch**: Auto-populates storage with your ngrok domain

### ✅ Infrastructure
- **Ngrok tunnel**: Running on Windows (auto-starts on boot)
- **Tunnel URL**: `https://french-handled-perkiness.ngrok-free.app`
- **Backend**: Runs inside desktop app or separately via `headless/index.js`

---

## Delivery Checklist

When ready to hand to client:

- [ ] Desktop app installer (or portable exe)
- [ ] Mobile APK file (download from EAS when ready)
- [ ] Verify ngrok tunnel is active on the PC
- [ ] Test: Open mobile app → should show inbox immediately (no config needed)
- [ ] Give PC to client (ngrok auto-starts on boot)
- [ ] Give phone to client (app is pre-configured)
- [ ] Client just uses it — zero setup required ✅

---

## If Build Fails Again

### Desktop Packaging Issue
```powershell
# Full cleanup approach:
cd c:\my-data\fb-ids-messenger
npm cache clean --force
Remove-Item -Force -Path "node_modules/better-sqlite3" -Recurse
npm install better-sqlite3
npm run package:win
```

### Mobile Build Monitoring
Check status here (no authentication needed):
https://expo.dev/accounts/veo3/projects/multi-fb-manager/builds/afd4ce2e-ea43-4832-9d38-d8382c817416

Look for:
- ✅ "Finished successfully" = APK is ready to download
- 🔄 "Running" = Still building
- ❌ "Failed" = See error message and run again

---

## Server Configuration

Both apps connect to: **`https://french-handled-perkiness.ngrok-free.app`**

### Desktop App
- Runs the backend server on port 3847
- Exposes via ngrok tunnel
- Stores data in SQLite

### Mobile App
- Connects to above URL
- All credentials baked in
- Auto-syncs inbox every 2 seconds

---

## Next Steps

1. **Wait for EAS build** (5-15 minutes typically)
   - Check the link above ⬆️

2. **Once APK is ready**: Download it

3. **Choose desktop packaging**:
   - Restart PC (Option B) — recommended
   - Or use quick manual method (Option A)

4. **Install mobile APK** on phone:
   - Transfer APK to phone
   - Open and install
   - Or: `adb install path/to/app-preview.apk`

5. **Test on client machine** (before handing over):
   - Desktop app starts → ngrok tunnel active
   - Mobile app installed → opens inbox
   - No configuration needed ✅

---

Done when: Client receives both apps and can use them immediately without any setup.
