const os = require('os');

// Use a User-Agent that matches the ACTUAL Chromium version in Electron 40 (Chromium ~134)
// Facebook checks if claimed browser version matches actual rendering capabilities.
// Mismatched versions cause Facebook to block/degrade the Messenger chat panel.
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0",
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Full stealth fingerprint script for injection into any context ──────────
// Works in both Playwright addInitScript and Electron executeJavaScript.
function getStealthScript() {
    const cpuCount = Math.max(4, os.cpus().length);
    return `(function() {
        if (window.__stealth_applied) return;
        window.__stealth_applied = true;

        // Remove navigator.webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // Set proper platform info
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

        // Set proper language
        Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

        // Set proper hardware concurrency (real browser value)
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${cpuCount} });

        // Mock Chrome object properly (Electron/headless lacks many chrome.* APIs)
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) {
            window.chrome.runtime = { connect: function(){}, sendMessage: function(){} };
        }
        if (!window.chrome.loadTimes) {
            window.chrome.loadTimes = function() {
                return {
                    commitLoadTime: Date.now() / 1000, connectionInfo: 'h2',
                    finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000,
                    firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000,
                    navigationType: 'Other', npnNegotiatedProtocol: 'h2',
                    requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000,
                    wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true
                };
            };
        }
        if (!window.chrome.csi) {
            window.chrome.csi = function() {
                return { onloadT: Date.now(), pageT: Date.now() / 1000, startE: Date.now(), tran: 15 };
            };
        }

        // Mask permissions queries (common bot check)
        if (navigator.permissions && navigator.permissions.query) {
            const originalQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters)
            );
        }

        // Proper plugin count matching real Chrome
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const plugins = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin' }
                ];
                plugins.length = 3;
                return plugins;
            }
        });

        // WebGL vendor/renderer spoofing (Facebook checks GPU info)
        try {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(param) {
                if (param === 37445) return 'Google Inc. (NVIDIA)';
                if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                return getParameter.call(this, param);
            };
        } catch(e) {}
    })();`;
}

/**
 * Apply stealth overrides to a Playwright BrowserContext.
 * Uses addInitScript so every page/navigation gets the patches.
 * @param {import('playwright').BrowserContext} context
 */
async function applyPlaywrightStealth(context) {
    try {
        await context.addInitScript(getStealthScript());
        console.log('[Stealth] Playwright stealth fingerprint applied');
    } catch (e) {
        console.error('[Stealth] Failed to apply Playwright stealth:', e.message);
    }
}

module.exports = { applyPlaywrightStealth, getRandomUserAgent };
