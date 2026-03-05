
import React, { useState, useEffect } from 'react';
import { Save, MessageCircle, Info, Send, Search } from 'lucide-react';

export default function TelegramSettings() {
    const [token, setToken] = useState('');
    const [chatId, setChatId] = useState('');
    
    // Proxy detailed state
    const [proxyProtocol, setProxyProtocol] = useState('http');
    const [proxyHost, setProxyHost] = useState('');
    const [proxyPort, setProxyPort] = useState('');
    const [proxyUser, setProxyUser] = useState('');
    const [proxyPass, setProxyPass] = useState('');
    
    const [status, setStatus] = useState('');
    const [testStatus, setTestStatus] = useState({ msg: '', type: '' }); // type: 'ok' | 'err' | 'loading'

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
        if (window.api) {
            window.api.getSetting('telegram_token').then(val => setToken(val || ''));
            window.api.getSetting('telegram_chat_id').then(val => setChatId(val || ''));
            
            window.api.getSetting('telegram_proxy').then(val => {
                if (val) {
                    try {
                        // Handle simple host:port case first (e.g. 1.2.3.4:8080)
                        if (!val.includes('://') && val.includes(':')) {
                            const parts = val.split(':');
                            if (parts.length === 2) {
                                setProxyHost(parts[0]);
                                setProxyPort(parts[1]);
                                return;
                            }
                        }

                        // Handle full URLs
                        const url = new URL(val);
                        // Remove trailing colon from protocol if present (http: -> http)
                        setProxyProtocol(url.protocol.replace(':', ''));
                        setProxyHost(url.hostname);
                        setProxyPort(url.port);
                        setProxyUser(url.username);
                        setProxyPass(url.password);
                    } catch (e) {
                        console.error("Failed to parse proxy string", e);
                        // If it fails to parse as URL but has content, treat as Host
                        // This allows user to overwrite "broken" strings easily
                        if (!proxyHost) setProxyHost(val); 
                    }
                }
            });
        }
    }, []);

    const handleSave = async () => {
        if (window.api) {
            let proxyString = '';
            
            // Only construct proxy string if Host AND Port are present
            if (proxyHost.trim() && proxyPort.trim()) {
                let auth = '';
                if (proxyUser.trim() && proxyPass.trim()) {
                    auth = `${encodeURIComponent(proxyUser)}:${encodeURIComponent(proxyPass)}@`;
                }
                
                const protocol = proxyProtocol.includes('sock') ? 'socks5' : 'http';
                // Ensure no double slashes or missing parts
                proxyString = `${protocol}://${auth}${proxyHost.trim()}:${proxyPort.trim()}`;
            } else if (proxyHost.trim() || proxyPort.trim()) {
                // Partial data - warn user? or just don't save faulty string
                // For now, let's allow clearing it if both are empty
                // If partial, maybe don't save a broken string
            }

            await window.api.saveSetting('telegram_token', token);
            await window.api.saveSetting('telegram_chat_id', chatId);
            
            // If fields are empty, we save empty string to CLEAR the setting
            await window.api.saveSetting('telegram_proxy', proxyString);
            
            setStatus('Settings saved! Bot restarting...');
            setTimeout(() => setStatus(''), 3000);
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="bg-slate-800/50 backdrop-blur-md border border-white/5 rounded-3xl p-8 shadow-xl">
                <div className="flex items-center gap-4 mb-8">
                    <div className="p-3 bg-blue-500/20 text-blue-400 rounded-xl">
                        <MessageCircle size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">Telegram Integration</h2>
                        <p className="text-slate-400 text-sm">Connect your bot to receive messages and reply from your phone.</p>
                    </div>
                </div>

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Bot Token</label>
                        <input 
                            type="text" 
                            className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                            placeholder="123456789:ABCdefGhIcF..."
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                        />
                        <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
                            <Info size={12} /> Get this from @BotFather
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Chat ID</label>
                        <div className="flex gap-2">
                            <input 
                                type="text" 
                                className="flex-1 bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
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
                                className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl flex items-center gap-2 transition-all text-sm font-medium whitespace-nowrap"
                                title="Auto-detect chat ID from recent messages"
                            >
                                <Search size={16} />
                                Detect
                            </button>
                        </div>
                         <p className="mt-2 text-xs text-slate-500 flex items-center gap-1">
                            <Info size={12} /> Send /start to your bot, then click Detect — or get manually from @userinfobot
                        </p>
                    </div>

                    <div className="pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-sm font-medium text-slate-300">Connection Options</h3>
                                <p className="text-xs text-slate-500">Enable if you have connection issues.</p>
                            </div>
                        </div>

                        <div className="mt-2 space-y-4 bg-slate-900/30 p-4 rounded-xl border border-white/5">
                            <label className="block text-sm font-medium text-slate-300">Manual Proxy</label>
                            
                            <div className="flex gap-4">
                                <div className="w-1/4">
                                    <label className="block text-xs text-slate-500 mb-1">Protocol</label>
                                    <select 
                                        value={proxyProtocol}
                                        onChange={(e) => setProxyProtocol(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-3 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                    >
                                        <option value="http">HTTP</option>
                                        <option value="socks5">SOCKS5</option>
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs text-slate-500 mb-1">Host / IP</label>
                                    <input 
                                        type="text" 
                                        placeholder="1.2.3.4"
                                        value={proxyHost}
                                        onChange={(e) => setProxyHost(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                                <div className="w-1/4">
                                    <label className="block text-xs text-slate-500 mb-1">Port</label>
                                    <input 
                                        type="text" 
                                        placeholder="8080"
                                        value={proxyPort}
                                        onChange={(e) => setProxyPort(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-xs text-slate-500 mb-1">Username (Optional)</label>
                                    <input 
                                        type="text" 
                                        placeholder="user"
                                        value={proxyUser}
                                        onChange={(e) => setProxyUser(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs text-slate-500 mb-1">Password (Optional)</label>
                                    <input 
                                        type="password" 
                                        placeholder="pass"
                                        value={proxyPass}
                                        onChange={(e) => setProxyPass(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <span className="text-xs text-slate-400 self-center">(auto-saved from your last bot conversation)</span>
                        <button 
                            onClick={handleSave}
                            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95"
                        >
                            <Save size={18} />
                            Save Configuration
                        </button>

                        <button
                            onClick={handleTest}
                            disabled={testStatus.type === 'loading'}
                            className="px-6 py-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 font-semibold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Send size={18} />
                            Test
                        </button>
                        
                        <button 
                            onClick={async () => {
                                if (window.api && confirm('Are you sure you want to reset all Telegram settings?')) {
                                    await window.api.invoke('settings:reset-telegram');
                                    setToken('');
                                    setChatId('');
                                    setProxyHost('');
                                    setProxyPort('');
                                    setProxyUser('');
                                    setProxyPass('');
                                    setStatus('Settings reset successfully.');
                                }
                            }}
                            className="px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-semibold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-red-500/20"
                        >
                            Reset
                        </button>
                    </div>

                    {status && (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-center text-sm font-medium animate-fade-in">
                            {status}
                        </div>
                    )}

                    {testStatus.msg && (
                        <div className={`p-4 rounded-xl text-center text-sm font-medium animate-fade-in border ${
                            testStatus.type === 'ok'
                                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                : testStatus.type === 'err'
                                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                                : 'bg-slate-700/50 border-white/10 text-slate-300'
                        }`}>
                            {testStatus.msg}
                        </div>
                    )}
                </div>

                <div className="mt-8 pt-8 border-t border-white/5">
                    <h3 className="text-sm font-semibold text-white mb-4">How it works</h3>
                    <ul className="space-y-2 text-sm text-slate-400 list-disc list-inside">
                        <li>Messages from tracked FB sessions are forwarded here.</li>
                        <li>Reply functionality: <code>/reply &lt;account_id&gt; &lt;message&gt;</code></li>
                        <li>Images and attachments show as links/text placeholders for now.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
