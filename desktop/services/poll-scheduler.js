/**
 * PollScheduler — Central staggered polling controller
 *
 * Problem it solves:
 *   With 30 accounts each running setInterval(2s) independently, all 30
 *   timers eventually converge and fire simultaneously → 30 concurrent
 *   Playwright page.evaluate() calls → CPU spike every 2 seconds.
 *
 * Solution:
 *   One shared 200ms master tick. Each registered account gets polled
 *   every POLL_INTERVAL_MS but staggered so only MAX_CONCURRENT run
 *   at the same time. Accounts that haven't been polled longest go first.
 *
 * Usage:
 *   PollScheduler.register(accountId, pollFn)   // call in MessageMonitor.attach()
 *   PollScheduler.unregister(accountId)          // call in MessageMonitor.detach()
 *   PollScheduler.start()                        // call once in main.js whenReady()
 *   PollScheduler.stop()                         // call in window-all-closed
 */

const POLL_INTERVAL_MS = 2_000;    // How often each account should be polled
const MASTER_TICK_MS  = 200;       // Resolution of the scheduler
const MAX_CONCURRENT  = 10;        // Max simultaneous Playwright evaluations

class PollScheduler {
    constructor() {
        // accountId → { fn: async () => void, lastPoll: number, running: bool }
        this._registry = new Map();
        this._timer = null;
    }

    /**
     * Register an account's poll function.
     * @param {string} accountId
     * @param {() => Promise<void>} fn  — async function that performs one poll cycle
     */
    register(accountId, fn) {
        if (this._registry.has(accountId)) {
            // Update the poll function (e.g. after context swap) but preserve lastPoll
            const existing = this._registry.get(accountId);
            existing.fn = fn;
            return;
        }
        // Spread initial lastPoll across the cycle so accounts don't all fire at t=0
        const spread = this._registry.size * (POLL_INTERVAL_MS / Math.max(this._registry.size + 1, 30));
        this._registry.set(accountId, {
            fn,
            lastPoll: Date.now() - POLL_INTERVAL_MS + spread,
            running: false,
        });
        console.log(`[PollScheduler] Registered ${accountId} (${this._registry.size} total)`);
    }

    /**
     * Unregister an account — e.g. when its context is being torn down.
     */
    unregister(accountId) {
        this._registry.delete(accountId);
        console.log(`[PollScheduler] Unregistered ${accountId} (${this._registry.size} remaining)`);
    }

    /**
     * Start the master tick. Call once from main.js after app.whenReady().
     */
    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this._tick(), MASTER_TICK_MS);
        console.log(`[PollScheduler] Started (interval=${POLL_INTERVAL_MS}ms, maxConcurrent=${MAX_CONCURRENT})`);
    }

    /**
     * Stop all polling. Call in window-all-closed.
     */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        console.log('[PollScheduler] Stopped');
    }

    _tick() {
        const now = Date.now();

        // Collect accounts due for a poll, sorted oldest-poll-first
        const due = [];
        for (const [accountId, state] of this._registry) {
            if (!state.running && (now - state.lastPoll) >= POLL_INTERVAL_MS) {
                due.push({ accountId, state, age: now - state.lastPoll });
            }
        }

        if (due.length === 0) return;

        // Sort by oldest first so no account starves
        due.sort((a, b) => b.age - a.age);

        // Count how many are currently running
        let running = 0;
        for (const { state } of this._registry.values ? [] : []) { /* unused */ }
        for (const s of this._registry.values()) {
            if (s.running) running++;
        }

        // Fire up to MAX_CONCURRENT
        const slots = MAX_CONCURRENT - running;
        const toFire = due.slice(0, Math.max(0, slots));

        for (const { accountId, state } of toFire) {
            state.running = true;
            state.lastPoll = now;
            state.fn().catch(err => {
                // Silently swallow — page may be navigating; next tick will retry
                if (err && !err.message?.includes('Target closed') && !err.message?.includes('Target page')) {
                    console.error(`[PollScheduler] Poll error for ${accountId}: ${err.message}`);
                }
            }).finally(() => {
                state.running = false;
            });
        }
    }
}

module.exports = new PollScheduler();
