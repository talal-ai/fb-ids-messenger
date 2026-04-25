# CLIENT DELIVERY CHECKLIST

Your ngrok domain is: **`french-handled-perkiness.ngrok-free.app`**

✅ **Step 1: Get the API Token** (MUST DO FIRST)
- Open the desktop app on your PC
- Go to Settings (bottom of the window)
- Copy the "API Token" value
- Save it somewhere safe

✅ **Step 2: Update mobile/lib/client-config.ts**
- File is already updated with your ngrok domain
- Replace `'YOUR-API-TOKEN-FROM-DESKTOP-APP'` with the token from Step 1
- Example:
  ```typescript
  const DEFAULT_SERVER_URL = 'https://french-handled-perkiness.ngrok-free.app';
  const DEFAULT_API_TOKEN  = 'abc123def456ghi789jkl';  // ← your actual token
  ```

✅ **Step 3: Build the Mobile App**
```bash
cd mobile
npx expo build --platform android   # or ios
```
- This creates the APK or IPA with the URL and token baked in

✅ **Step 4: Verify the Desktop App is Running**
- The desktop app must be running on the PC
- Verify ngrok tunnel is active (should auto-start from the installer)
- Test: Open a browser and visit `https://french-handled-perkiness.ngrok-free.app/`
  - Should show something or a 404, NOT a connection error

✅ **Step 5: Install Mobile App on Client's Phone**
- Install the built APK/IPA on the client's phone
- Open the app — it auto-configures itself
- **Client does nothing**

✅ **Step 6: Hand Over to Client**
- Give them the PC (desktop app auto-starts on boot)
- Give them the phone (mobile app already configured)
- They just use it — zero setup required

---

## If Something Goes Wrong

**"Mobile app can't reach server"**
- Verify desktop app is running on the PC
- Verify ngrok tunnel is active: `ngrok config check`
- Verify the domain in `client-config.ts` matches your ngrok domain exactly
- Try visiting the URL in a browser from the phone's browser (not the app) to test connectivity

**"API Token not recognized"**
- Make sure you copied it exactly from the desktop app Settings (no extra spaces)
- Verify you pasted it in `client-config.ts` correctly
- Rebuild the app after changing the token

**"ngrok tunnel stopped"**
- ngrok should auto-restart on PC boot (installed as service/task)
- Manually: Run `ngrok http 3847` in command line
- Or check the Task Scheduler for "NgrokTunnel" entry

---

## Files Modified

- ✅ `mobile/lib/client-config.ts` — auto-config values
- ✅ `mobile/app/_layout.tsx` — auto-populate on first launch
- ✅ `deploy/windows/DEVELOPER_INSTALL_ON_CLIENT.bat` — developer setup script

Ready to deliver? You've got this. 🚀
