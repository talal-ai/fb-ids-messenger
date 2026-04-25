/**
 * CLIENT DEFAULT CONFIG
 * ─────────────────────────────────────────────────────────────
 * Fill these in BEFORE building and distributing the app to
 * your client. The app will auto-configure itself on first launch.
 *
 * The client will never have to open Settings or type a URL.
 *
 * HOW TO USE:
 *   1. Set NGROK_DOMAIN = the permanent ngrok URL you created
 *   2. Set API_TOKEN    = the token from the desktop app Settings
 *   3. Build the app: npx expo build  (or EAS build)
 *   4. Deliver. Done.
 */

const DEFAULT_SERVER_URL = 'https://french-handled-perkiness.ngrok-free.app';
const DEFAULT_API_TOKEN  = 'fc0f45d6ec364069bf20121cec576d315c95068c48c2f5922434b98eddb42ae7';

export { DEFAULT_SERVER_URL, DEFAULT_API_TOKEN };
