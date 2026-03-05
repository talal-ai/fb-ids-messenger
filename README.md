# Multi-FB Manager

Desktop application for managing multiple Facebook accounts simultaneously. Notifications from Facebook sessions can be forwarded to a Telegram bot and replied back from the desktop or mobile.

## Building & Packaging

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the renderer UI:
   ```bash
   npm run vite
   ```
3. Create a distributable for your platform (Windows/macOS/Linux):
   ```bash
   npm run package
   ```
   Build artifacts will appear in the `release/` folder. Provide the appropriate installer or zipped app to your client.

> On macOS you must run the build on a Mac if you want a `.dmg`/`.pkg`.
>
> **Installer wizard (Windows)**
> The NSIS target produces a standard installation wizard with a welcome screen, license step, destination chooser, and an option to create a desktop/start-menu shortcut. Simply run `npm run package` on Windows and hand the resulting `.exe` to your client; they will be guided through the native-looking installer.

## Running in Development

- `npm run dev` starts Vite and launches the desktop window. Use this while developing.
  By default the developer tools are **not** opened; set `OPEN_DEVTOOLS=true` in the
  same environment if you need them:
  ```bash
  OPEN_DEVTOOLS=true npm run dev
  ```

## Client Handover Notes

- Give the client the installer or zipped app produced by the packaging step.
- Ensure they fill in their own Telegram token and optionally chat ID via **Settings → Telegram**. Ask them to send `/start` to the bot to register their chat.
- If you previously interacted with the bot, your chat ID will be replaced when the client sends `/start`.
- There are no user-exposed references to `electron` in the UI or documentation; the code lives under the `desktop/` directory for clarity.

## Troubleshooting

See `RUNNING_THE_APP.md` for step‑by‑step instructions on launching the server, desktop app, and mobile front end. Most issues relate to networking between the phone and PC.
