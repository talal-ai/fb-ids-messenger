# Client Handover: Multi-FB Manager

## Overview

You receive **two applications**:
1. **Desktop App** (Windows) — Runs on your PC, manages Facebook accounts
2. **Mobile App** (Android/iOS) — Connects to your PC from anywhere

## Quick Start (5 Minutes)

### Step 1: Install Desktop App

1. Run `Multi FB Manager Setup.exe`
2. App opens automatically
3. No configuration needed yet

### Step 2: Add Facebook Account

1. In Desktop app, go to **"Active Sessions"** tab
2. Click **"Add Account"**
3. Enter a nickname (e.g., "My FB Account")
4. A browser window opens — **log into Facebook normally**
5. Close the browser window when done
6. Account now runs in background (headless)

**Repeat for additional accounts.**

### Step 3: Enable Cloud Access

1. Go to **"Cloud Access"** tab in Desktop app
2. Click **"Enable Cloud Access"**
3. Wait 10-30 seconds (first-time setup downloads secure tunnel)
4. You get a **Public URL** like: `https://fbmgr-abc123.trycloudflare.com`
5. URL is **automatically copied to clipboard**

### Step 4: Install Mobile App

**Android:**
1. Transfer `FB-Manager.apk` to phone
2. Install (allow "Unknown Sources" if prompted)

**iOS:**
1. Install via TestFlight (link will be provided)

### Step 5: Connect Mobile to Desktop

1. Open Mobile app
2. Go to **Settings** tab
3. Enter:
   - **Server URL**: Paste the URL from Step 3 (e.g., `https://fbmgr-abc123.trycloudflare.com`)
   - **API Token**: Find this in Desktop app → **API Settings** tab → copy "API Token"
4. Tap **"Test Connection"** — should show ✅
5. Tap **"Save"**

### Step 6: Start Messaging

1. Go to **Inbox** tab in Mobile app
2. You see all conversations from your Facebook accounts
3. Tap any conversation to chat
4. Replies send through your Desktop app to Facebook

---

## What Just Happened? (Technical Summary)

```
┌─────────────┐      Cloudflare       ┌─────────────┐
│  Your PC    │  <───Secure Tunnel──> │ Mobile App  │
│  (Desktop)  │   HTTPS (automatic)   │ (Anywhere)  │
└──────┬──────┘                       └─────────────┘
       │
       ├─► Playwright browsers (headless)
       ├─► Facebook cookies saved locally
       ├─► Message detection running 24/7
       └─► SQLite database (messages, history)
```

**No VPS. No manual uploads. No port forwarding.**

---

## Important: Session Expiry

Facebook sessions expire every 1-3 months. When this happens:

### Symptoms
- Mobile app shows "Connection OK" but no new messages
- Desktop app shows account status as "needs_login"

### Fix (2 Minutes)

1. Desktop app → **"Active Sessions"**
2. Find the account with ⚠️ "needs_login" status
3. Click **"Open"** — browser window opens
4. **Re-login to Facebook** (may require 2FA)
5. Close browser window
6. Go to **"Cloud Access"** tab
7. Click **"Regenerate URL"** (or keep using old URL — usually still works)
8. Done — Mobile app reconnects automatically

---

## Troubleshooting

### Mobile App Won't Connect

| Issue | Solution |
|-------|----------|
| "Connection failed" | Check Desktop app is running |
| "Unauthorized" | Re-copy API Token from Desktop → API Settings |
| URL changed | Update Server URL in Mobile app Settings |

### Desktop App Won't Start

1. Check Windows Defender / Antivirus — add exception for `Multi FB Manager`
2. Ensure port 3847 is not blocked (app will warn if so)
3. Restart PC, try again

### Messages Not Sending

1. Check account status in Desktop app → should be **"active"**
2. If "offline" — click **"Open"** to re-activate
3. Wait 30 seconds, retry

### Cloud Access Won't Start

1. Check internet connection
2. First startup downloads Cloudflare binary (~15MB) — may take 1-2 minutes on slow connections
3. Click **"Enable Cloud Access"** again

---

## Security Notes

1. **Your data stays on your PC** — Messages database and Facebook cookies never leave your machine
2. **HTTPS tunnel** — Cloudflare provides bank-grade encryption between Mobile and Desktop
3. **API Token required** — Random strangers cannot access your API even if they guess the URL
4. **Regenerate URL anytime** — If you suspect the URL leaked, click "Regenerate URL" in Cloud Access tab

---

## File Locations (For Advanced Users)

| Data | Location |
|------|----------|
| Messages Database | `%USERPROFILE%\.fb-ids-messenger\database.sqlite` |
| Facebook Cookies | `%USERPROFILE%\.fb-ids-messenger\profiles\acc_xxxx\` |
| App Settings | `%APPDATA%\multi-fb-manager\` |

---

## Support

For technical support, contact your developer with:
1. Screenshot of Desktop app → Dashboard
2. Screenshot of Desktop app → Cloud Access status
3. Screenshot of Mobile app → Settings

---

## Summary

| Feature | How To |
|---------|--------|
| Add FB account | Click "Add Account", login in browser |
| Use mobile app | Enable Cloud Access, copy URL to mobile |
| Fix expired login | Click "Open", re-login, regenerate URL |
| Secure access | Keep API Token secret, regenerate URL if needed |

**Your Facebook accounts, running 24/7 on your PC, controlled from your phone, anywhere in the world.**
