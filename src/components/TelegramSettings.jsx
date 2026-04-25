
import React, { useState, useEffect } from 'react';
import { Save, MessageCircle, Info, Send, Search, Smartphone, Copy, Check } from 'lucide-react';

export default function TelegramSettings() {
    // ── Mobile API ───────────────────────────────────────────────────────
    const [apiToken, setApiToken] = useState('');
    const [apiPort, setApiPort] = useState('3847');
    const [apiStatus, setApiStatus] = useState('');
    const [copied, setCopied] = useState(false);

    // ── Telegram ─────────────────────────────────────────────────────────
    const [token, setToken] = useState('');
    const [chatId, setChatId] = useState('');

    // Proxy detailed state
    const [proxyProtocol, setProxyProtocol] = useState('http');
    const [proxyHost, setProxyHost] = useState('');
    const [proxyPort, setProxyPort] = useState('');
    const [proxyUser, setProxyUser] = useState('');
    const [proxyPass, setProxyPass] = useState('');

    const [status, setStatus] = useState('');
    const [testStatus, setTestStatus] = useState({ msg: '', type: '' });

    const handleTest = async () => {
        if (!window.api) return;
        setTestStatus({ msg: 'Sending...', type: 'loading' });
        try {
            const result = await window.api.testTelegram();
            if (result && result.success) {
                const route = result.route ? ` (${result.route})` : '';
                const warning = result.warning ? ` ${result.warning}` : '';
                setTestStatus({ msg: `✅ Message sent${route}! Check your Telegram.${warning}`, type: 'ok' });
            } else {
                setTestStatus({ msg: `❌ ${result?.error || 'Unknown error'}`, type: 'err' });
            }
        } catch (e) {
            setTestStatus({ msg: `❌ ${e.message}`, type: 'err' });
        }
        setTimeout(() => setTestStatus({ msg: '', type: '' }), 5000);
    };

    useEffect(() => {
        if (!window.api) return;
        window.api.getSetting('control_plane_token').then(val => setApiToken(val || ''));
        window.api.getSetting('control_plane_http_port').then(val => setApiPort(val || '3847'));
        window.api.getSetting('telegram_token').then(val => setToken(val || ''));
        window.api.getSetting('telegram_chat_id').then(val => setChatId(val || ''));

        const unsub = window.api.onControlPlaneStatus((status) => {
            if (status === 'stopping') setApiStatus('Stopping old server...');
            else if (status === 'no-token') setApiStatus('⚠ No token set — server not started.');
            else if (status.startsWith('running:')) setApiStatus(`✓ Server running on port ${status.split(':')[1]}`);
            else if (status.startsWith('error:')) setApiStatus(`✗ Error: ${status.slice(6)}`);
        });
        return () => { if (typeof unsub === 'function') unsub(); };

        window.api.getSetting('telegram_proxy').then(val => {
            if (val) {
                try {
                    if (!val.includes('://') && val.includes(':')) {
                        const parts = val.split(':');
                        if (parts.length === 2) {
                            setProxyHost(parts[0]);
                            setProxyPort(parts[1]);
                            return;
                        }
                    }
                    const url = new URL(val);
                    setProxyProtocol(url.protocol.replace(':', ''));
                    setProxyHost(url.hostname);
                    setProxyPort(url.port);
                    setProxyUser(url.username);
                    setProxyPass(url.password);
                } catch (e) {
                    if (!proxyHost) setProxyHost(val);
                }
            }
        });
    }, []);

    const handleSaveApi = async () => {
        if (!window.api) return;
        setApiStatus('Saving...');
        await window.api.saveSetting('control_plane_token', apiToken.trim());
        await window.api.saveSetting('control_plane_http_port', apiPort.trim() || '3847');
        // status will be updated by onControlPlaneStatus listener
    };

    const handleCopyToken = () => {
        navigator.clipboard.writeText(apiToken);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSave = async () => {
        if (window.api) {
            let proxyString = '';
            if (proxyHost.trim() && proxyPort.trim()) {
                let auth = '';
                if (proxyUser.trim() && proxyPass.trim()) {
                    auth = `${encodeURIComponent(proxyUser)}:${encodeURIComponent(proxyPass)}@`;
                }
                const protocol = proxyProtocol.includes('sock') ? 'socks5' : 'http';
                proxyString = `${protocol}://${auth}${proxyHost.trim()}:${proxyPort.trim()}`;
            }
            await window.api.saveSetting('telegram_token', token);
            await window.api.saveSetting('telegram_chat_id', chatId);
            await window.api.saveSetting('telegram_proxy', proxyString);
            setStatus('Settings saved! Bot restarting...');
            setTimeout(() => setStatus(''), 3000);
        }
    };

    return (
        <div className="p-4 max-w-3xl mx-auto space-y-4">

            {/* ── Mobile API Section ───────────────────────────────────── */}
            <div className="rounded-2xl bg-slate-900/50 backdrop-blur-sm border border-white/[0.06] p-6 shadow-glass">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-11 h-11 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                        <Smartphone size={22} />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-white">Mobile App API</h2>
                        <p className="text-slate-500 text-sm mt-0.5">Token used by your iOS/Android app to connect</p>
                    </div>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">API Token</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                className="flex-1 bg-slate-800/80 border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors font-mono"
                                placeholder="Set a strong secret token (e.g. a random 32-char string)"
                                value={apiToken}
                                onChange={(e) => setApiToken(e.target.value)}
                            />
                            {apiToken && (
                                <button
                                    onClick={handleCopyToken}
                                    className="px-3 py-2.5 bg-slate-700/80 hover:bg-slate-600 text-slate-200 rounded-xl text-sm transition-colors"
                                    title="Copy token"
                                >
                                    {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                                </button>
                            )}
                        </div>
                        <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
                            <Info size={12} /> Enter this token in the mobile app Settings screen
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Port</label>
                        <input
                            type="text"
                            className="w-32 bg-slate-800/80 border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                            value={apiPort}
                            onChange={(e) => setApiPort(e.target.value)}
                        />
                        <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
                            <Info size={12} /> Mobile app URL: <code className="text-slate-400 font-mono text-xs bg-slate-800/60 px-1.5 py-0.5 rounded ml-1">http://&lt;this-PC-IP&gt;:{apiPort}</code>
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSaveApi}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl flex items-center gap-2 transition-colors"
                        >
                            <Save size={18} />
                            Save & Restart
                        </button>
                    </div>

                    {apiStatus && (
                        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl text-sm font-medium animate-fade-in">
                            {apiStatus}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Telegram Section ─────────────────────────────────────── */}
            <div className="rounded-2xl bg-slate-900/50 backdrop-blur-sm border border-white/[0.06] p-6 shadow-glass">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-11 h-11 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0">
                        <MessageCircle size={22} />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-white">Telegram (Fallback)</h2>
                        <p className="text-slate-500 text-sm mt-0.5">Optional — used if mobile app is unavailable</p>
                    </div>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Bot Token</label>
                        <input
                            type="text"
                            className="w-full bg-slate-800/80 border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                            placeholder="123456789:ABCdefGhIcF..."
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                        />
                        <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
                            <Info size={12} /> Get this from @BotFather
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1.5">Chat ID</label>
                        <div className="flex gap-2 flex-wrap">
                            <input
                                type="text"
                                className="flex-1 min-w-[140px] bg-slate-800/80 border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
                                placeholder="123456789"
                                value={chatId}
                                onChange={(e) => setChatId(e.target.value)}
                            />
                            <button
                                onClick={async () => {
                                    if (!window.api) return;
                                    setTestStatus({ msg: 'Detecting chat ID... Send /start to your bot first!', type: 'loading' });
                                    try {
                                        const result = await window.api.detectTelegramChat();
                                        if (result && result.success) {
                                            setChatId(result.chatId);
                                            setTestStatus({ msg: `Found: ${result.chatName || result.chatId} (${result.chatId})`, type: 'ok' });
                                        } else {
                                            setTestStatus({ msg: `\u274c ${result?.error || 'No messages found'}`, type: 'err' });
                                        }
                                    } catch (e) {
                                        setTestStatus({ msg: `\u274c ${e.message}`, type: 'err' });
                                    }
                                    setTimeout(() => setTestStatus({ msg: '', type: '' }), 8000);
                                }}
                                className="px-4 py-2.5 bg-slate-700/80 hover:bg-slate-600 text-slate-200 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors focus-ring"
                                title="Auto-detect chat ID from recent messages"
                            >
                                <Search size={16} />
                                Detect
                            </button>
                        </div>
                        <p className="mt-1.5 text-xs text-slate-500 flex items-center gap-1">
                            <Info size={12} /> Send /start to your bot, then Detect — or get from @userinfobot
                        </p>
                    </div>

                    <div className="pt-5 border-t border-white/[0.06]">
                        <h3 className="text-sm font-medium text-slate-300 mb-1">Connection options</h3>
                        <p className="text-xs text-slate-500 mb-3">Use if you have connection issues</p>
                        <div className="space-y-4 rounded-xl bg-slate-800/40 p-4 border border-white/[0.04]">
                            <label className="block text-sm font-medium text-slate-300">Manual proxy</label>
                            <div className="flex flex-wrap gap-3">
                                <div className="w-24">
                                    <label className="block text-xs text-slate-500 mb-1">Protocol</label>
                                    <select
                                        value={proxyProtocol}
                                        onChange={(e) => setProxyProtocol(e.target.value)}
                                        className="w-full bg-slate-900/60 border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    >
                                        <option value="http">HTTP</option>
                                        <option value="socks5">SOCKS5</option>
                                    </select>
                                </div>
                                <div className="flex-1 min-w-[120px]">
                                    <label className="block text-xs text-slate-500 mb-1">Host</label>
                                    <input
                                        type="text"
                                        placeholder="1.2.3.4"
                                        value={proxyHost}
                                        onChange={(e) => setProxyHost(e.target.value)}
                                        className="w-full bg-slate-900/60 border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    />
                                </div>
                                <div className="w-24">
                                    <label className="block text-xs text-slate-500 mb-1">Port</label>
                                    <input
                                        type="text"
                                        placeholder="8080"
                                        value={proxyPort}
                                        onChange={(e) => setProxyPort(e.target.value)}
                                        className="w-full bg-slate-900/60 border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    />
                                </div>
                                <div className="flex-1 min-w-[120px]">
                                    <label className="block text-xs text-slate-500 mb-1">Username (optional)</label>
                                    <input
                                        type="text"
                                        placeholder="user"
                                        value={proxyUser}
                                        onChange={(e) => setProxyUser(e.target.value)}
                                        className="w-full bg-slate-900/60 border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    />
                                </div>
                                <div className="flex-1 min-w-[120px]">
                                    <label className="block text-xs text-slate-500 mb-1">Password (optional)</label>
                                    <input
                                        type="password"
                                        placeholder="••••"
                                        value={proxyPass}
                                        onChange={(e) => setProxyPass(e.target.value)}
                                        className="w-full bg-slate-900/60 border border-white/[0.08] rounded-lg px-3 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button
                            onClick={handleSave}
                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl flex items-center gap-2 transition-colors focus-ring"
                        >
                            <Save size={18} />
                            Save
                        </button>
                        <button
                            onClick={handleTest}
                            disabled={testStatus.type === 'loading'}
                            className="px-4 py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-sm font-medium rounded-xl flex items-center gap-2 border border-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-ring"
                        >
                            <Send size={16} />
                            Test
                        </button>
                        <button
                            onClick={async () => {
                                if (window.api && confirm('Reset all Telegram settings?')) {
                                    await window.api.resetTelegramSettings();
                                    setToken('');
                                    setChatId('');
                                    setProxyHost('');
                                    setProxyPort('');
                                    setProxyUser('');
                                    setProxyPass('');
                                    setStatus('Settings reset.');
                                }
                            }}
                            className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-xl border border-red-500/20 transition-colors focus-ring"
                        >
                            Reset
                        </button>
                        <span className="text-xs text-slate-500">Auto-saved from last bot conversation</span>
                    </div>

                    {status && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm font-medium animate-fade-in">
                            {status}
                        </div>
                    )}

                    {testStatus.msg && (
                        <div className={`p-3 rounded-xl text-sm font-medium animate-fade-in border ${
                            testStatus.type === 'ok' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                            testStatus.type === 'err' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                            'bg-slate-800/50 border-white/[0.06] text-slate-300'
                        }`}>
                            {testStatus.msg}
                        </div>
                    )}
                </div>

                <div className="mt-6 pt-6 border-t border-white/[0.06]">
                    <h3 className="text-sm font-semibold text-white mb-2">How it works</h3>
                    <ul className="space-y-1.5 text-sm text-slate-500 list-disc list-inside">
                        <li>FB session messages are forwarded to this chat.</li>
                        <li>Reply: <code className="text-slate-400 font-mono text-xs bg-slate-800/60 px-1.5 py-0.5 rounded">/reply &lt;account_id&gt; &lt;message&gt;</code></li>
                        <li>Attachments appear as links for now.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
