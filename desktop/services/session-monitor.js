/**
 * Session Monitor — Playwright-native health checking & keep-alive
 *
 * Periodically checks each active Facebook account:
 *   1. Is the page still on facebook.com/messages?
 *   2. Has the session expired (redirect to /login or /checkpoint)?
 *   3. Keeps session warm with low-impact heartbeat (avoids aggressive reloads).
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
    constructor(playwrightManager, database, telegramBot, intervalMs = 480_000) {
        this.pm = playwrightManager;
        this.db = database;
        this.tg = telegramBot;
        this.intervalMs = intervalMs;
        this._timer = null;
        // Track which accounts have already been alerted to avoid spamming
        this._alertedAccounts = new Set();
        // Track last soft-health refresh time per account (rare fallback only)
        this._lastReload = new Map();
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

    /**
     * Clear the one-shot alert flag for an account after a successful relaunch.
     * Called from main.js watchdog on successful restart.
     */
    clearAlert(accountId) {
        this._alertedAccounts.delete(accountId);
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
            page = this.pm.getPage(acc.id);
            if (!page) return;
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

        // Active heartbeat: mouse signal every cycle; very rare soft reload fallback.
        const lastReload = this._lastReload.get(acc.id) || 0;
        const hoursSinceReload = (Date.now() - lastReload) / 3_600_000;

        // Avoid frequent forced reloads; they can trigger FB anti-abuse checks.
        // Only do a rare fallback refresh every 24h if page appears healthy.
        if (hoursSinceReload >= 24) {
            console.log(`[SessionMonitor] 24h soft reload for ${acc.id}`);
            try {
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
                this._lastReload.set(acc.id, Date.now());
            } catch (err) {
                console.warn(`[SessionMonitor] Reload failed for ${acc.id}:`, err.message);
            }
        } else {
            // Mouse activity signal — keeps session warm without risky XHR calls
            try {
                await page.mouse.move(640 + Math.random() * 100, 400 + Math.random() * 50);
            } catch (_) { /* page navigating — harmless */ }
        }
    }
}

module.exports = SessionMonitor;
