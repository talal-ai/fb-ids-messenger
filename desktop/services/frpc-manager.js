const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Lazy-load electron — this module may be required in headless (non-Electron) mode
function getApp() {
    try {
        return require('electron').app;
    } catch {
        return null;
    }
}

/**
 * FRP Tunnel Manager (frpc)
 *
 * Replaces the ephemeral Cloudflare quick-tunnel with a PERMANENT reverse
 * tunnel to our own VPS. The public hostname never changes, so the mobile
 * app is configured once and survives every desktop restart.
 *
 * Chain:
 *   mobile → https://multi-messenger.gadgetronics.pk  (Apache :443, Let's Encrypt)
 *          → 127.0.0.1:8788  (frps on the VPS, local-only)
 *          → reverse tunnel over :7000
 *          → frpc (this process) → localhost:<localPort> (control-plane API)
 *
 * The interface mirrors cloudflared-manager so main.js can swap one require.
 *
 * Connection settings default to the provisioned VPS but can be overridden
 * (e.g. for white-label deployments) via electron-store keys or env vars:
 *   frp_server_addr / FRP_SERVER_ADDR
 *   frp_server_port / FRP_SERVER_PORT
 *   frp_token       / FRP_TOKEN
 *   frp_remote_port / FRP_REMOTE_PORT
 *   frp_public_url  / FRP_PUBLIC_URL
 */

const BINARY_NAME = os.platform() === 'win32' ? 'frpc.exe' : 'frpc';

// Provisioned VPS defaults (multi-messenger.gadgetronics.pk).
const DEFAULTS = {
    serverAddr: '5.189.174.219',
    serverPort: 7000,
    token: '78ea2ed625f3a3cac10daad57650f349950a5f7eacb02095',
    remotePort: 8788,
    publicUrl: 'https://multi-messenger.gadgetronics.pk'
};

// Generous startup window: if the previous session hasn't been released on the
// server yet, frpc auto-retries the proxy roughly every ~30s and binds once the
// slot frees. We wait that out rather than failing.
const STARTUP_TIMEOUT_MS = 90000;

// Resolve the bundled frpc binary in both dev and packaged (electron-builder
// extraResources) layouts, falling back to a globally installed frpc.
function getBinaryPath() {
    const candidates = [];
    // Packaged: extraResources copies resources/frpc → <resourcesPath>/frpc
    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'frpc', BINARY_NAME));
    }
    // Dev: repo resources/frpc/<binary>
    candidates.push(path.join(__dirname, '..', '..', 'resources', 'frpc', BINARY_NAME));
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    // Last resort: rely on PATH
    return BINARY_NAME;
}

function getTunnelDir() {
    const electronApp = getApp();
    const userData = electronApp
        ? electronApp.getPath('userData')
        : path.join(os.homedir(), '.fb-ids-messenger');
    return path.join(userData, 'tunnel');
}

class FrpcManager {
    constructor() {
        this.process = null;
        this.currentUrl = null;
        this.logBuffer = [];
        this.startPromise = null;
        this.configGetter = null; // optional (key) => value, injected from main via setConfigSource
    }

    /**
     * Optionally inject a config source (e.g. electron-store.get) so deployments
     * can override the VPS target without rebuilding.
     */
    setConfigSource(getter) {
        this.configGetter = typeof getter === 'function' ? getter : null;
    }

    resolveConfig() {
        const get = (storeKey, envKey, fallback) => {
            const fromStore = this.configGetter ? this.configGetter(storeKey) : undefined;
            if (fromStore !== undefined && fromStore !== null && `${fromStore}`.trim() !== '') {
                return fromStore;
            }
            const fromEnv = process.env[envKey];
            if (fromEnv !== undefined && fromEnv !== null && `${fromEnv}`.trim() !== '') {
                return fromEnv;
            }
            return fallback;
        };
        return {
            serverAddr: get('frp_server_addr', 'FRP_SERVER_ADDR', DEFAULTS.serverAddr),
            serverPort: Number(get('frp_server_port', 'FRP_SERVER_PORT', DEFAULTS.serverPort)),
            token: get('frp_token', 'FRP_TOKEN', DEFAULTS.token),
            remotePort: Number(get('frp_remote_port', 'FRP_REMOTE_PORT', DEFAULTS.remotePort)),
            publicUrl: get('frp_public_url', 'FRP_PUBLIC_URL', DEFAULTS.publicUrl)
        };
    }

    isBinaryUsable(binaryPath) {
        const result = spawnSync(binaryPath, ['--version'], { stdio: 'ignore', shell: false });
        return result.status === 0;
    }

    writeConfig(localPort, cfg) {
        const dir = getTunnelDir();
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const configPath = path.join(dir, 'frpc.toml');
        const toml = [
            `serverAddr = "${cfg.serverAddr}"`,
            `serverPort = ${cfg.serverPort}`,
            `auth.method = "token"`,
            `auth.token = "${cfg.token}"`,
            `loginFailExit = false`,
            ``,
            `[[proxies]]`,
            `name = "messenger"`,
            `type = "tcp"`,
            `localIP = "127.0.0.1"`,
            `localPort = ${localPort}`,
            `remotePort = ${cfg.remotePort}`,
            // Encrypt the VPS↔desktop leg. Apache terminates TLS, so without this the
            // proxied HTTP (Bearer token + message text) would cross the public
            // internet in the clear between the server and this PC.
            `transport.useEncryption = true`,
            `transport.useCompression = true`,
            ``
        ].join('\n');
        fs.writeFileSync(configPath, toml, 'utf8');
        return configPath;
    }

    /**
     * Start the reverse tunnel to a local port.
     * @param {number} localPort - control-plane HTTP port (e.g. 3847)
     * @returns {Promise<string>} the permanent public HTTPS URL
     */
    async start(localPort, onProgress) {
        if (this.currentUrl) {
            console.log('[Tunnel] Already running at', this.currentUrl);
            return this.currentUrl;
        }
        if (this.startPromise) {
            return this.startPromise;
        }

        this.startPromise = (async () => {
            const cfg = this.resolveConfig();
            const binaryPath = getBinaryPath();

            if (onProgress) onProgress('checking', 'Checking tunnel client...');
            if (!this.isBinaryUsable(binaryPath)) {
                throw new Error(
                    `frpc binary not found or unusable at "${binaryPath}". ` +
                    `Expected it bundled under resources/frpc.`
                );
            }

            const configPath = this.writeConfig(localPort, cfg);

            if (onProgress) onProgress('starting', 'Connecting secure tunnel...');
            console.log(`[Tunnel] Starting frpc (port ${localPort} → ${cfg.publicUrl})`);

            return new Promise((resolve, reject) => {
                const child = spawn(binaryPath, ['-c', configPath], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: false
                });

                this.process = child;
                this.logBuffer = [];

                let settled = false;
                const startupTimer = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        this.stop();
                        reject(new Error('Tunnel startup timeout — could not connect to VPS in time'));
                    }
                }, STARTUP_TIMEOUT_MS);

                const onLine = (text) => {
                    this.logBuffer.push(text);
                    console.log('[Tunnel]', text.trim());
                    // frpc logs "start proxy success" once the remote port is bound.
                    if (!settled && /start proxy success/i.test(text)) {
                        settled = true;
                        clearTimeout(startupTimer);
                        this.currentUrl = cfg.publicUrl;
                        console.log('[Tunnel] ✅ Public URL:', this.currentUrl);
                        if (onProgress) onProgress('ready', 'Tunnel ready!');
                        resolve(this.currentUrl);
                    } else if (!settled && /login to server success/i.test(text)) {
                        if (onProgress) onProgress('connecting', 'Authenticated — binding tunnel...');
                    } else if (!settled && /(port already used|proxy.*already exists)/i.test(text)) {
                        // A previous tunnel session hasn't been released on the server yet
                        // (e.g. the app was just restarted). Do NOT abort — frpc keeps the
                        // control connection open and re-attempts the proxy automatically,
                        // binding as soon as the old slot frees. We simply keep waiting until
                        // "start proxy success" or the startup timeout.
                        if (onProgress) onProgress('connecting', 'Previous session still closing — reconnecting…');
                    }
                };

                child.stdout.on('data', (d) => onLine(d.toString()));
                child.stderr.on('data', (d) => onLine(d.toString()));

                child.on('error', (err) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(startupTimer);
                        reject(new Error(`Failed to start tunnel: ${err.message}`));
                    }
                });

                child.on('close', (code) => {
                    console.log(`[Tunnel] frpc exited with code ${code}`);
                    this.process = null;
                    this.currentUrl = null;
                });
            });
        })();

        try {
            return await this.startPromise;
        } finally {
            this.startPromise = null;
        }
    }

    async stop() {
        if (!this.process) return;
        console.log('[Tunnel] Stopping frpc...');
        const child = this.process;
        child.kill('SIGTERM');
        setTimeout(() => {
            if (child && !child.killed) {
                child.kill('SIGKILL');
            }
        }, 5000);
        this.process = null;
        this.currentUrl = null;
    }

    getStatus() {
        return {
            running: !!this.process,
            url: this.currentUrl,
            logs: this.logBuffer.slice(-50)
        };
    }

    async quickConnect(localPort, onProgress) {
        try {
            const url = await this.start(localPort, onProgress);
            return { success: true, url, message: 'Cloud access enabled' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
}

const manager = new FrpcManager();
module.exports = manager;
