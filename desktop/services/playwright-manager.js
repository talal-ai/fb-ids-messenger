
const { chromium } = require('playwright');
const path = require('path');
const { app } = require('electron');
const { applyPlaywrightStealth, getRandomUserAgent } = require('./stealth-service');

// ─── Launch arg sets ──────────────────────────────────────────────────────────
// Base flags applied to ALL contexts (headless and visible)
const LEAN_ARGS_BASE = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-infobars',
    '--disable-background-networking',       // Stop background sync draining CPU
    '--disable-background-timer-throttling', // Keep JS timers accurate
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-extensions',
    '--disable-translate',
    '--disable-spell-check',
    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
    '--no-first-run',
    '--no-default-browser-check',
    '--memory-pressure-off',
];

// Extra flags only for headless (monitoring) contexts — not safe for visible login
const LEAN_ARGS_HEADLESS_ONLY = [
    '--disable-gpu',                         // No GPU needed for headless monitoring
    '--disable-dev-shm-usage',               // Prevent /dev/shm OOM on Linux
    '--blink-settings=imagesEnabled=false',  // No images needed — text detection only (huge RAM saving)
    '--js-flags=--max-old-space-size=256',   // Cap V8 heap at 256 MB (default is 1.5 GB)
];

class PlaywrightManager {
    constructor() {
        this.contexts = new Map(); // accountId -> BrowserContext
        this.userDataRoot = path.join(app.getPath('userData'), 'profiles');
    }

    /**
     * Launch a persistent context for a specific account.
     * @param {string} accountId 
     * @param {boolean} headless - false if user needs to login interactively
     */
    async launchAccount(accountId, headless = true) {
        if (this.contexts.has(accountId)) {
            const existingContext = this.contexts.get(accountId);
            if (!headless) {
                console.log(`[Playwright] Re-launching ${accountId} in visible mode...`);
                await existingContext.close();
                this.contexts.delete(accountId);
            } else {
                return existingContext;
            }
        }

        const profileDir = path.join(this.userDataRoot, accountId);
        console.log(`[Playwright] Launching ${accountId} (headless=${headless})`);

        // Headless gets full lean flag set; visible gets only base (images + GPU needed for login)
        const args = headless
            ? [...LEAN_ARGS_BASE, ...LEAN_ARGS_HEADLESS_ONLY]
            : LEAN_ARGS_BASE;

        const launchOptions = {
            headless: headless,
            viewport: { width: 1280, height: 800 },
            userAgent: getRandomUserAgent(),
            args,
        };

        let context;
        try {
            console.log(`[Playwright] Trying channel: chrome`);
            context = await chromium.launchPersistentContext(profileDir, { ...launchOptions, channel: 'chrome' });
        } catch (errChrome) {
            console.log(`[Playwright] Chrome not found, trying msedge. Error: ${errChrome.message}`);
            try {
                context = await chromium.launchPersistentContext(profileDir, { ...launchOptions, channel: 'msedge' });
            } catch (errEdge) {
                console.log(`[Playwright] msedge not found, trying default bundled chromium. Error: ${errEdge.message}`);
                context = await chromium.launchPersistentContext(profileDir, launchOptions);
            }
        }

        // Apply full stealth fingerprint via addInitScript
        await applyPlaywrightStealth(context);

        this.contexts.set(accountId, context);
        return context;
    }

    /**
     * Get an existing page or create a new one for Messenger.
     * Ensures the page is on facebook.com/messages and sidebar is loaded.
     */
    async getMessengerPage(accountId) {
        const context = this.contexts.get(accountId);
        if (!context) throw new Error(`Context not found for ${accountId}`);

        let page;
        if (context.pages().length > 0) {
            page = context.pages()[0];
        } else {
            page = await context.newPage();
        }

        // If the page isn't already showing Facebook/Messenger, navigate there.
        const url = page.url();
        if (!url || url.startsWith('about:blank') || (!url.includes('messenger.com') && !url.includes('facebook.com'))) {
            await page.goto('https://www.facebook.com/messages', { timeout: 30000, waitUntil: 'domcontentloaded' });
            // Wait for sidebar to render so detection can begin immediately
            await page.waitForSelector('a[href*="/messages/t/"]', { timeout: 15000 }).catch(() => {
                console.warn(`[Playwright] Sidebar links not found for ${accountId} — page may need login`);
            });
        }

        return page;
    }

    async closeAccount(accountId) {
        const context = this.contexts.get(accountId);
        if (context) {
            await context.close();
            this.contexts.delete(accountId);
        }
    }

    async closeAll() {
        for (const accountId of this.contexts.keys()) {
            await this.closeAccount(accountId);
        }
    }

    /** Check if a browser context exists for this account */
    hasContext(accountId) {
        return this.contexts.has(accountId);
    }

    /** Remove context from tracking without closing it (for post-close cleanup) */
    removeContext(accountId) {
        this.contexts.delete(accountId);
    }

    /**
     * Extract logged-in Facebook user identity from a Messenger page.
     * Tries multiple strategies; returns { fbName, fbUserId } or null.
     */
    async extractFbIdentity(accountId) {
        try {
            const context = this.contexts.get(accountId);
            if (!context) return null;
            const page = context.pages()[0];
            if (!page) return null;

            // Wait a bit for Messenger to fully render
            await page.waitForTimeout(3000);

            const result = await page.evaluate(() => {
                // Strategy 1: profile settings link in sidebar
                const profileLink = document.querySelector('a[href*="/me/"], a[aria-label*="profile"], a[aria-label*="Profile"]');
                const profileName = profileLink ? profileLink.getAttribute('aria-label') : null;

                // Strategy 2: The user menu / avatar area  
                const avatarEl = document.querySelector('[data-testid="mwthreadlist-header"] span, div[role="banner"] span');
                const avatarName = avatarEl ? avatarEl.textContent : null;

                // Strategy 3: document title
                const titleName = document.title && document.title !== 'Messenger' ? document.title.replace(' - Messenger', '').replace('Messenger', '').trim() : null;

                // Strategy 4: Look for meta user tag
                let fbId = null;
                try {
                    const metaEl = document.querySelector('meta[name="user"]');
                    fbId = metaEl ? metaEl.getAttribute('content') : null;
                } catch (_) {}

                // Strategy 5: Extract from cookies
                try {
                    const cUser = document.cookie.split(';').find(c => c.trim().startsWith('c_user='));
                    if (cUser) fbId = cUser.split('=')[1].trim();
                } catch (_) {}

                return {
                    fbName: profileName || avatarName || titleName || null,
                    fbUserId: fbId || null
                };
            });

            return result;
        } catch (err) {
            console.error(`[Playwright] Failed to extract identity for ${accountId}:`, err.message);
            return null;
        }
    }
}

module.exports = new PlaywrightManager();
