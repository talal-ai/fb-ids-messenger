# How to Run the Multi‑FB Manager System

To run the full system involves 3 separate terminals.

## 1. Backend Relay Server (The "Brain")
This handles communication between your PC and the Mobile App.
1. Open a terminal.
2. Navigate to the server folder: `cd server`
3. Install dependencies (first time only): `npm install`
4. Start the server:
   ```bash
   npm start
   ```
   *You should see: "Relay Server running on port 3000"*

## 2. Desktop App (The "Control Panel")
This is the Multi‑FB Manager desktop application.
1. Open a **new** terminal in the main project folder.
2. Install dependencies (first time only): `npm install`
3. Start the app:
   ```bash
   npm run dev
   ```
   *This will launch the Multi‑FB Manager window.*

## 3. Mobile App (The "Remote")
This runs on your phone via Expo Go.

**Important: Connect via LAN**
Your phone must reach your computer.
1. Find your computer's IP address:
   - Windows: Run `ipconfig` in a terminal (look for IPv4 Address, e.g., `192.168.1.50`).
2. Open `multi-messenger/constants/config.ts`.
3. Update `SOCKET_URL` to match your IP:
   ```typescript
   export const SOCKET_URL = 'http://192.168.1.50:3000'; // Replace with YOUR IP
   ```

**Start the App:**
1. Open a **new** terminal.
2. Navigate to the mobile folder: `cd multi-messenger`
3. Install dependencies: `npm install`
4. Start Expo:
   ```bash
   npx expo start
   ```
5. Scan the QR code with the **Expo Go** app on your Android/iOS device.
