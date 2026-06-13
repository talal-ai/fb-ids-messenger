/**
 * CLIENT DEFAULT CONFIG
 * ─────────────────────────────────────────────────────────────
 * Leave these empty for the default build.
 *
 * The client configures the app at runtime via Settings tab:
 *   1. Desktop app → Cloud Access tab → Enable → copy URL
 *   2. Mobile app → Settings tab → paste URL + API Token
 *
 * For white-label / pre-configured builds only:
 *   Fill these BEFORE building, then build & distribute.
 */

// Permanent backend on our VPS (multi-messenger.gadgetronics.pk).
// This URL never changes — the desktop app opens a reverse tunnel to it on launch,
// so the mobile app is configured once and survives every desktop restart.
const DEFAULT_SERVER_URL = 'https://multi-messenger.gadgetronics.pk';

// Must match the desktop app's Settings → Control Plane Token (set once, never changes).
const DEFAULT_API_TOKEN  = '58649e16c9a9a50b17b49cd5cd90527c4575a73f9386c896';

export { DEFAULT_SERVER_URL, DEFAULT_API_TOKEN };
