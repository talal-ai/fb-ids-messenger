const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// Lazy-load electron — this module may be required in headless (non-Electron) mode
function getApp() {
    try {
        return require('electron').app;
    } catch {
        return null;
    }
}

/**
 * Cloudflare Tunnel Manager
 * 
 * Automatically creates secure HTTPS tunnels for the control-plane API
 * No account needed. Uses Cloudflare's free trycloudflare.com service.
 * 
 * Usage:
 *   const tunnel = require('./cloudflared-manager');
 *   const url = await tunnel.start(3847);  // Returns https://xxxx.trycloudflare.com
 *   await tunnel.stop();  // Cleanup
 */

const TUNNEL_DOMAIN = 'trycloudflare.com';
const BINARY_NAME = os.platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared';

// Use app.getPath('userData') for persistent storage
function getBinaryPath() {
    const electronApp = getApp();
    const userData = electronApp ? electronApp.getPath('userData') : path.join(os.homedir(), '.fb-ids-messenger');
    return path.join(userData, 'bin', BINARY_NAME);
}

function getTunnelDir() {
    const electronApp = getApp();
    const userData = electronApp ? electronApp.getPath('userData') : path.join(os.homedir(), '.fb-ids-messenger');
    return path.join(userData, 'tunnel');
}

// Download URLs from Cloudflare's official releases
const DOWNLOAD_URLS = {
    win32: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
    // Cloudflare publishes Darwin binaries as .tgz archives. We avoid auto-downloading
    // archives here because spawning archive files causes EFTYPE/exec format errors.
    darwin: null,
    linux: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64'
};

const STARTUP_TIMEOUT_MS = 120000;
const STARTUP_EXTENSION_MS = 60000;

class CloudflaredManager {
    constructor() {
        this.process = null;
        this.currentUrl = null;
        this.logBuffer = [];
        this.startPromise = null;
    }

    /**
     * Download cloudflared binary if not present
     */
    async ensureBinary(onProgress) {
        const binaryPath = getBinaryPath();

        // Prefer globally installed cloudflared when available.
        if (this.isCloudflaredOnPath()) {
            return 'cloudflared';
        }
        
        if (fs.existsSync(binaryPath)) {
            const stat = fs.statSync(binaryPath);
            if (!stat.isFile()) {
                fs.rmSync(binaryPath, { recursive: true, force: true });
            } else if (this.isBinaryUsable(binaryPath)) {
                console.log('[Tunnel] Binary already exists at', binaryPath);
                return binaryPath;
            } else {
                fs.rmSync(binaryPath, { force: true });
            }
        }

        if (onProgress) onProgress('downloading', 'Downloading cloudflared (~10 MB)...');
        console.log('[Tunnel] Downloading cloudflared binary...');
        
        const binDir = path.dirname(binaryPath);
        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
        }

        const platform = os.platform();
        const url = DOWNLOAD_URLS[platform];
        
        if (!url) {
            throw new Error(
                'No auto-download available for this platform. Install cloudflared manually and ensure it is on PATH.'
            );
        }

        await this.downloadFile(url, binaryPath);
        
        // Make executable on Unix
        if (platform !== 'win32') {
            fs.chmodSync(binaryPath, 0o755);
        }

        if (!this.isBinaryUsable(binaryPath)) {
            throw new Error('Downloaded cloudflared binary is invalid or not executable.');
        }

        console.log('[Tunnel] Binary downloaded to', binaryPath);
        return binaryPath;
    }

    isCloudflaredOnPath() {
        const result = spawnSync('cloudflared', ['--version'], {
            stdio: 'ignore',
            shell: false
        });
        return result.status === 0;
    }

    isBinaryUsable(binaryPath) {
        const result = spawnSync(binaryPath, ['--version'], {
            stdio: 'ignore',
            shell: false
        });
        return result.status === 0;
    }

    downloadFile(url, dest) {
        const maxRedirects = 5;

        const requestWithRedirects = (currentUrl, redirectsLeft) => new Promise((resolve, reject) => {
            https.get(currentUrl, (response) => {
                const isRedirect = [301, 302, 303, 307, 308].includes(response.statusCode);
                if (isRedirect) {
                    response.resume();
                    if (!response.headers.location) {
                        reject(new Error('Download redirect missing Location header'));
                        return;
                    }
                    if (redirectsLeft <= 0) {
                        reject(new Error('Too many redirects while downloading cloudflared'));
                        return;
                    }
                    resolve(requestWithRedirects(response.headers.location, redirectsLeft - 1));
                    return;
                }

                if (response.statusCode !== 200) {
                    response.resume();
                    reject(new Error(`Download failed with status ${response.statusCode}`));
                    return;
                }

                const file = fs.createWriteStream(dest);
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
                file.on('error', (err) => {
                    file.close();
                    fs.rmSync(dest, { force: true });
                    reject(err);
                });
            }).on('error', reject);
        });

        return requestWithRedirects(url, maxRedirects);
    }

    /**
     * Start tunnel to local port
     * @param {number} localPort - The local port to tunnel (e.g., 3847)
     * @returns {Promise<string>} The public HTTPS URL
     */
    async start(localPort, onProgress) {
        if (this.currentUrl) {
            console.log('[Tunnel] Already running at', this.currentUrl);
            return this.currentUrl;
        }

        // If startup is already in progress, await the existing promise so
        // concurrent callers receive the same resolved URL.
        if (this.startPromise) {
            return this.startPromise;
        }

        this.startPromise = (async () => {
            if (onProgress) onProgress('checking', 'Checking cloudflared binary...');
            const binaryPath = await this.ensureBinary(onProgress);

            if (onProgress) onProgress('starting', 'Launching tunnel process...');
            console.log(`[Tunnel] Starting tunnel to port ${localPort}...`);

            return new Promise((resolve, reject) => {
                const tunnelProcess = spawn(binaryPath, [
                    'tunnel',
                    '--url', `http://localhost:${localPort}`,
                    '--no-autoupdate'
                ], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    detached: false
                });

                this.process = tunnelProcess;
                this.logBuffer = [];

                let urlFound = false;
                let startupTimer = null;
                let hasExtendedStartupWait = false;
                const failStartup = () => {
                    if (!urlFound) {
                        this.stop();
                        reject(new Error('Tunnel startup timeout - could not get URL in time'));
                    }
                };
                const resetStartupTimer = (ms) => {
                    if (startupTimer) clearTimeout(startupTimer);
                    startupTimer = setTimeout(failStartup, ms);
                };

                resetStartupTimer(STARTUP_TIMEOUT_MS);

                // Parse stdout AND stderr for the tunnel URL.
                // cloudflared writes the URL banner to stderr in current versions.
                const checkForUrl = (text) => {
                    const match = text.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
                    if (match && !urlFound) {
                        urlFound = true;
                        if (startupTimer) clearTimeout(startupTimer);
                        this.currentUrl = match[1];
                        console.log('[Tunnel] ✅ Public URL:', this.currentUrl);
                        if (onProgress) onProgress('ready', 'Tunnel ready!');
                        resolve(this.currentUrl);
                    }
                };

                tunnelProcess.stdout.on('data', (data) => {
                    const text = data.toString();
                    this.logBuffer.push(text);
                    console.log('[Tunnel stdout]', text.trim());
                    checkForUrl(text);
                });

                tunnelProcess.stderr.on('data', (data) => {
                    const text = data.toString();
                    this.logBuffer.push(text);
                    console.log('[Tunnel stderr]', text.trim());
                    // Primary URL detection — cloudflared writes the URL banner to stderr
                    checkForUrl(text);
                    if (!urlFound && onProgress && text.includes('Registered tunnel connection')) {
                        onProgress('connecting', 'Connected to Cloudflare — waiting for URL...');
                        if (!hasExtendedStartupWait) {
                            hasExtendedStartupWait = true;
                            resetStartupTimer(STARTUP_EXTENSION_MS);
                        }
                    }
                });

                tunnelProcess.on('error', (err) => {
                    if (startupTimer) clearTimeout(startupTimer);
                    reject(new Error(`Failed to start tunnel: ${err.message}`));
                });

                tunnelProcess.on('close', (code) => {
                    console.log(`[Tunnel] Process exited with code ${code}`);
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

    /**
     * Stop the tunnel
     */
    async stop() {
        if (!this.process) {
            return;
        }

        console.log('[Tunnel] Stopping...');
        
        // Kill gracefully first
        this.process.kill('SIGTERM');
        
        // Force kill after 5 seconds
        setTimeout(() => {
            if (this.process && !this.process.killed) {
                this.process.kill('SIGKILL');
            }
        }, 5000);

        this.process = null;
        this.currentUrl = null;
    }

    /**
     * Get current tunnel status
     */
    getStatus() {
        return {
            running: !!this.process,
            url: this.currentUrl,
            logs: this.logBuffer.slice(-50) // Last 50 log lines
        };
    }

    /**
     * Quick connect - start tunnel and return URL in one call
     */
    async quickConnect(localPort, onProgress) {
        try {
            const url = await this.start(localPort, onProgress);
            return {
                success: true,
                url,
                message: 'Cloud access enabled'
            };
        } catch (err) {
            return {
                success: false,
                error: err.message
            };
        }
    }
}

// Singleton instance
const manager = new CloudflaredManager();

module.exports = manager;
