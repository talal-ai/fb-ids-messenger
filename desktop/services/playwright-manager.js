
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
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
        if (process.env.FB_DATA_DIR) {
            this.userDataRoot = path.join(process.env.FB_DATA_DIR, 'profiles');
        } else {
            const { app } = require('electron');
            this.userDataRoot = path.join(app.getPath('userData'), 'profiles');
        }
    }

    /**
     * Use one stable user-agent per account profile.
     * Random UA changes between launches can trigger Facebook session challenges.
     */
    _getStableUserAgent(accountId, profileDir) {
        try {
            const uaPath = path.join(profileDir, '.ua');
            if (fs.existsSync(uaPath)) {
                const existing = fs.readFileSync(uaPath, 'utf8').trim();
                if (existing) return existing;
            }
            const ua = getRandomUserAgent();
            fs.mkdirSync(profileDir, { recursive: true });
            fs.writeFileSync(uaPath, ua, 'utf8');
            return ua;
        } catch (_) {
            // Fallback if file I/O fails
            return getRandomUserAgent();
        }
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
            userAgent: this._getStableUserAgent(accountId, profileDir),
            permissions: ['clipboard-read', 'clipboard-write'],
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

    /** Get the first page for an account, or null if no context or no pages. */
    getPage(accountId) {
        const context = this.contexts.get(accountId);
        if (!context || !context.pages) return null;
        const pages = context.pages();
        return pages.length > 0 ? pages[0] : null;
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
            await new Promise(r => setTimeout(r, 3000));

            const result = await page.evaluate(() => {
                // Strategy 1: profile settings link in sidebar
                const profileLink = document.querySelector('a[href*="/me/"], a[aria-label*="profile"], a[aria-label*="Profile"]');
                let profileName = profileLink ? profileLink.getAttribute('aria-label') : null;
                if (profileName && (profileName.toLowerCase().includes('profile') || profileName.toLowerCase().includes('settings'))) {
                    // try to get actual text if label is just "Profile"
                    const text = profileLink.innerText.trim();
                    if (text && text.length > 2) profileName = text;
                }

                // Strategy 2: The user menu / avatar area  
                const avatarEl = document.querySelector('[data-testid="mwthreadlist-header"] span, div[role="banner"] span');
                const avatarName = avatarEl ? avatarEl.textContent.trim() : null;

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

            if (result && result.fbName) {
                // Clean up name: remove common FB suffix " (Account)" etc.
                result.fbName = result.fbName.replace(/\s*\(.*?\)\s*/g, '').trim();
                // Discard useless generic names the scraper picks up from page elements
                const junk = ['facebook', 'messenger', 'profile', 'meta', 'settings', 'menu', ''];
                if (junk.includes(result.fbName.toLowerCase())) {
                    result.fbName = null;
                }
            }

            return result;
        } catch (err) {
            console.error(`[Playwright] Failed to extract identity for ${accountId}:`, err.message);
            return null;
        }
    }

    /**
     * Scrape conversation history from a thread.
     * @param {string} accountId 
     * @param {string} conversationId 
     * @param {number} limit 
     */
    async fetchHistory(accountId, conversationId, limit = 30) {
        const page = await this.getMessengerPage(accountId);
        
        // Navigate if not already there
        const urls = [
            `https://www.facebook.com/messages/t/${conversationId}/`,
            `https://www.facebook.com/messages/e2ee/t/${conversationId}/`
        ];
        
        const currentUrl = page.url();
        if (!currentUrl.includes(`/t/${conversationId}/`)) {
            console.log(`[Playwright] Navigating to ${urls[0]} for history sync`);
            await page.goto(urls[0], { waitUntil: 'domcontentloaded', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
        }

        // Scrape messages using selectors specific to Facebook Messenger's chat bubbles.
        // We avoid [role="listitem"] at the top level because Facebook's sidebar / info
        // panel also uses it for nav items like "Privacy & support", "Media and files" etc.
        const messages = await page.evaluate((max) => {
            // ── Junk content filter ───────────────────────────────────────────────
            const JUNK_EXACT = new Set([
                'privacy & support', 'media and files', 'customise chat', 'chat info',
                'notifications', 'search in conversation', 'view profile', 'block',
                'something went wrong', 'you are now connected on messenger',
                'say hi to your new facebook friend', 'you sent', 'message sent',
                'enter, message sent', 'enter', 'you', '',
            ]);
            const JUNK_PREFIX = [
                'enter, message sent', 'message sent today', 'message sent yesterday',
                'tap to retry', 'this message was deleted',
            ];

            function isJunk(text) {
                const t = text.trim().toLowerCase();
                if (t.length === 0 || t.length > 2000) return true;
                if (JUNK_EXACT.has(t)) return true;
                if (JUNK_PREFIX.some(p => t.startsWith(p))) return true;
                // Single word system labels (FB nav) are usually short capitalised words
                if (/^[A-Z][a-z]+$/.test(text.trim()) && text.trim().length < 20) {
                    // But allow short real messages if they look like chat (no space needed)
                    // Real messages are rarely single proper-cased words from a nav menu
                    // We still allow them if they are clearly conversational (hi, ok, yes, etc)
                    const conversational = new Set(['hi', 'ok', 'yes', 'no', 'hey', 'yo', 'bye', 'lol', 'wow']);
                    if (!conversational.has(text.trim().toLowerCase())) {
                        // Extra check: if it matches known FB nav labels, skip
                        const navLabels = new Set(['files', 'links', 'photos', 'videos', 'audio',
                            'notifications', 'privacy', 'support', 'customise', 'block', 'mute']);
                        if (navLabels.has(t)) return true;
                    }
                }
                return false;
            }

            // ── Target actual message bubbles ─────────────────────────────────────
            // Facebook Messenger renders chat messages in a scrollable list whose
            // items have role="row" or are nested under [aria-label*="Messages"].
            // Bubbles themselves usually have dir="auto" text and are inside a
            // container that has specific data-testid or structural clues.
            const results = [];

            // Strategy: find all dir="auto" text nodes inside the messages viewport,
            // then walk up to find the row-level container.
            const allTextEls = Array.from(document.querySelectorAll('[dir="auto"]'));

            for (const textEl of allTextEls) {
                const body = (textEl.innerText || '').trim();
                if (isJunk(body)) continue;

                // Only accept text elements inside a recognisable message container.
                // Reject anything inside the left sidebar or info panel.
                const inSidebar = textEl.closest('[aria-label*="Chats"], [aria-label*="Chat info"], nav, aside');
                if (inSidebar) continue;

                // Determine direction (outgoing vs incoming) by looking at flex alignment
                // on ancestor containers. Outgoing bubbles are in flex-end rows.
                const row = textEl.closest('[role="row"], [role="listitem"], [role="gridcell"]');
                let isOutgoing = false;
                if (row) {
                    const style = window.getComputedStyle(row);
                    isOutgoing = style.justifyContent === 'flex-end' ||
                        row.innerText.includes('You sent') ||
                        !!row.closest('[style*="justify-content: flex-end"]');
                } else {
                    // Fallback: check parent chain for flex-end
                    let el = textEl.parentElement;
                    for (let i = 0; i < 8 && el; i++) {
                        const s = window.getComputedStyle(el);
                        if (s.justifyContent === 'flex-end') { isOutgoing = true; break; }
                        el = el.parentElement;
                    }
                }

                // Timestamp from aria-label on a nearby time element
                let ts = Date.now();
                const container = row || textEl.parentElement;
                if (container) {
                    const timeEl = container.querySelector('[aria-label*="AM"], [aria-label*="PM"], time');
                    if (timeEl) {
                        const label = timeEl.getAttribute('aria-label') ||
                                       timeEl.getAttribute('datetime') || '';
                        const parsed = Date.parse(label);
                        if (parsed && parsed > 0) ts = parsed;
                    }
                }

                results.push({
                    body,
                    isOutgoing: isOutgoing ? 1 : 0,
                    timestamp: ts,
                    senderName: isOutgoing ? 'You' : null,
                });

                if (results.length >= max) break;
            }

            return results;
        }, limit);

        return messages;
    }
}

module.exports = new PlaywrightManager();
