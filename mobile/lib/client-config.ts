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

const DEFAULT_SERVER_URL = '';  // e.g. 'https://fbmgr-abc.trycloudflare.com'
const DEFAULT_API_TOKEN  = '';  // e.g. 'your-secret-token'

export { DEFAULT_SERVER_URL, DEFAULT_API_TOKEN };
