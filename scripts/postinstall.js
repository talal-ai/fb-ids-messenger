/**
 * postinstall.js
 * Only runs the desktop-specific native rebuild steps when NOT on EAS / CI.
 * This prevents the EAS mobile build from running Electron/Playwright setup.
 */
if (process.env.EAS_BUILD) {
    console.log('[postinstall] EAS environment detected — skipping desktop native setup.');
    process.exit(0);
}

if (process.env.CI) {
    console.log('[postinstall] CI — rebuilding better-sqlite3 for Electron (skipping Playwright)...');
    execSync('npx @electron/rebuild -f -w better-sqlite3', { stdio: 'inherit' });
    process.exit(0);
}

const { execSync } = require('child_process');

console.log('[postinstall] Installing Playwright Chromium...');
execSync('npx playwright install chromium', { stdio: 'inherit' });

console.log('[postinstall] Rebuilding better-sqlite3 for Electron...');
execSync('npx @electron/rebuild -f -w better-sqlite3', { stdio: 'inherit' });
