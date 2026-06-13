/**
 * postinstall.js
 * Desktop native setup. Skipped entirely on EAS (mobile builds).
 * On CI, only rebuilds better-sqlite3 (Playwright install is not needed in GitHub Actions).
 */
const { execSync } = require('child_process');

if (process.env.EAS_BUILD) {
    console.log('[postinstall] EAS environment detected — skipping desktop native setup.');
    process.exit(0);
}

if (process.env.CI) {
    console.log('[postinstall] CI — rebuilding better-sqlite3 for Electron (skipping Playwright)...');
    execSync('npx @electron/rebuild -f -w better-sqlite3', { stdio: 'inherit' });
    process.exit(0);
}

console.log('[postinstall] Installing Playwright Chromium...');
execSync('npx playwright install chromium', { stdio: 'inherit' });

console.log('[postinstall] Rebuilding better-sqlite3 for Electron...');
execSync('npx @electron/rebuild -f -w better-sqlite3', { stdio: 'inherit' });
