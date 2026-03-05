/**
 * Session Monitor — Playwright-native health checking & keep-alive
 *
 * Periodically checks each active Facebook account:
 *   1. Is the page still on facebook.com/messages?
 *   2. Has the session expired (redirect to /login or /checkpoint)?
 *   3. Soft-refreshes the page to prevent cookie/session expiry.
 *
 * Alerts the user via Telegram when sessions expire.
 */

class SessionMonitor {
    /**
     * @param {object} playwrightManager
     * @param {object} database - Database module
     * @param {object} telegramBot - TelegramBot module
     * @param {number} intervalMs - Check interval (default: 10 minutes)
     */
    constructor(playwrightManager, database, telegramBot, intervalMs = 600_000) {
        this.pm = playwrightManager;
        this.db = database;
        this.tg = telegramBot;
        this.intervalMs = intervalMs;
        this._timer = null;
        // Track which accounts have already been alerted to avoid spamming
        this._alertedAccounts = new Set();
    }

    start() {
        if (this._timer) return;
        console.log(`[SessionMonitor] Starting — checking every ${this.intervalMs / 60000} min`);
        // First check after 2 minutes (let accounts boot)
        setTimeout(() => this._runAll(), 120_000);
        this._timer = setInterval(() => this._runAll(), this.intervalMs);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    async _runAll() {
        try {
            const accounts = this.db.getDb()
                .prepare("SELECT id, nickname, fb_name FROM accounts WHERE status = 'active' OR status = 'needs_login'")
                .all();

            for (const acc of accounts) {
                try {
                    await this._checkAccount(acc);
                } catch (err) {
                    console.error(`[SessionMonitor] Error checking ${acc.id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[SessionMonitor] _runAll error:', err.message);
        }
    }

    async _checkAccount(acc) {
        if (!this.pm.hasContext(acc.id)) {
            // No browser context — Watchdog in main.js handles relaunch
            return;
        }

        let page;
        try {
            const context = this.pm.contexts.get(acc.id);
            if (!context || context.pages().length === 0) return;
            page = context.pages()[0];
        } catch (err) {
            return;
        }

        const url = page.url();
        const label = acc.fb_name || acc.nickname || acc.id;

        // Check for login/checkpoint redirect
        if (url.includes('/login') || url.includes('/checkpoint')) {
            console.warn(`[SessionMonitor] ${acc.id} (${label}) session expired! URL: ${url}`);
            this.db.getDb().prepare('UPDATE accounts SET status = ? WHERE id = ?').run('needs_login', acc.id);

            // Only alert ONCE per expired session (don't spam every 10 min)
            if (!this._alertedAccounts.has(acc.id)) {
                this._alertedAccounts.add(acc.id);
                try {
                    const esc = (t) => (t || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
                    await this.tg.sendNotification(
                        `⚠️ *Session Expired*\n\n` +
                        `Account: ${esc(label)} \(${esc(acc.id)}\)\n` +
                        `Please open the app and re\-login\.`,
                        null // no reply context for alerts
                    );
                } catch (_) {}
            }
            return;
        }

        // If not on Messenger, navigate back
        if (!url.includes('facebook.com/messages') && !url.includes('messenger.com')) {
            console.log(`[SessionMonitor] ${acc.id} on wrong page, navigating back: ${url.substring(0, 80)}`);
            try {
                await page.goto('https://www.facebook.com/messages', {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                });
            } catch (err) {
                console.error(`[SessionMonitor] Navigation back failed for ${acc.id}:`, err.message);
            }
            return;
        }

        // Keep-alive: verify sidebar is rendering (indicates active session)
        try {
            const hasSidebar = await page.evaluate(() => {
                return document.querySelectorAll('a[href*="/messages/t/"]').length > 0;
            });

            if (!hasSidebar) {
                console.log(`[SessionMonitor] ${acc.id} sidebar empty, refreshing...`);
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
            }
        } catch (err) {
            // Page may be navigating — not critical
            console.warn(`[SessionMonitor] Sidebar check failed for ${acc.id}:`, err.message);
        }
    }
}

module.exports = SessionMonitor;
