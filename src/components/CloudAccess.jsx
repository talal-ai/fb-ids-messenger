import React, { useState, useEffect } from 'react';
import { Globe, Copy, Check, Loader2, ExternalLink, RefreshCw, QrCode, CheckCircle, Circle, AlertTriangle } from 'lucide-react';

const PROGRESS_STEPS = [
    { id: 'checking',    label: 'Checking tunnel client' },
    { id: 'starting',    label: 'Connecting secure tunnel' },
    { id: 'connecting',  label: 'Authenticating with server' },
    { id: 'ready',       label: 'Tunnel ready' },
];

export default function CloudAccess() {
    const [status, setStatus] = useState('connecting'); // connecting, active, error
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [activeStep, setActiveStep] = useState('checking');

    useEffect(() => {
        checkStatus();
        const interval = setInterval(checkStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!window.api?.onCloudProgress) return;
        const unsub = window.api.onCloudProgress(({ step, message }) => {
            setActiveStep(step);
            if (step === 'ready') setStatus('active');
        });
        return unsub;
    }, []);

    const checkStatus = async () => {
        if (!window.api) return;
        try {
            const result = await window.api.getCloudStatus();
            if (result.running && result.url) {
                setStatus('active');
                setUrl(result.url);
                setActiveStep(null);
            }
        } catch (e) {
            console.error('Failed to check cloud status:', e);
        }
    };

    const reconnect = async () => {
        setStatus('connecting');
        setError('');
        setActiveStep('checking');
        try {
            const result = await window.api.enableCloud();
            setActiveStep(null);
            if (result.success && result.url) {
                setStatus('active');
                setUrl(result.url);
            } else {
                setStatus('error');
                setError(result.error || 'Failed to connect tunnel');
            }
        } catch (e) {
            setActiveStep(null);
            setStatus('error');
            setError(e.message);
        }
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    const activeIdx = PROGRESS_STEPS.findIndex(s => s.id === activeStep);

    return (
        <div className="rounded-2xl bg-slate-900/50 backdrop-blur-sm border border-white/[0.06] p-6 shadow-glass">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 text-orange-400 flex items-center justify-center shrink-0">
                    <Globe size={22} />
                </div>
                <div>
                    <h2 className="text-lg font-semibold text-white">Cloud Access</h2>
                    <p className="text-slate-500 text-sm mt-0.5">Permanent backend — mobile app connects automatically</p>
                </div>
            </div>

            {/* Status bar — no toggle button */}
            <div className={`
                rounded-xl p-4 mb-5 border transition-all duration-300
                ${status === 'active'     ? 'bg-emerald-500/10 border-emerald-500/30' : ''}
                ${status === 'connecting' ? 'bg-amber-500/10  border-amber-500/30'    : ''}
                ${status === 'error'      ? 'bg-red-500/10    border-red-500/30'      : ''}
            `}>
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${
                        status === 'active'     ? 'bg-emerald-500 animate-pulse' :
                        status === 'connecting' ? 'bg-amber-500  animate-pulse' :
                                                 'bg-red-500'
                    }`} />
                    <span className={`font-medium ${
                        status === 'active'     ? 'text-emerald-400' :
                        status === 'connecting' ? 'text-amber-400'  :
                                                 'text-red-400'
                    }`}>
                        {status === 'active'     && 'Tunnel Active — Backend Online'}
                        {status === 'connecting' && 'Connecting to VPS...'}
                        {status === 'error'      && 'Connection Failed'}
                    </span>
                </div>
                {error && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-start gap-2">
                        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}
            </div>

            {/* CONNECTING — progress steps */}
            {status === 'connecting' && (
                <div className="mb-5 p-5 bg-slate-800/60 border border-amber-500/20 rounded-xl">
                    <p className="text-sm font-semibold text-amber-300 mb-4">Establishing secure tunnel to your VPS...</p>
                    <div className="space-y-3">
                        {PROGRESS_STEPS.map((step, idx) => {
                            const isDone    = activeIdx > idx;
                            const isActive  = activeIdx === idx;
                            const isPending = activeIdx < idx || activeIdx === -1;
                            return (
                                <div key={step.id} className="flex items-center gap-3">
                                    <div className="w-5 h-5 flex items-center justify-center shrink-0">
                                        {isDone    && <CheckCircle size={18} className="text-emerald-400" />}
                                        {isActive  && <Loader2    size={18} className="text-amber-400 animate-spin" />}
                                        {isPending && !isDone && !isActive && <Circle size={18} className="text-slate-600" />}
                                    </div>
                                    <span className={`text-sm ${
                                        isDone    ? 'text-emerald-400 line-through decoration-emerald-700/60' :
                                        isActive  ? 'text-amber-300 font-medium' :
                                                    'text-slate-600'
                                    }`}>
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="mt-4 text-xs text-slate-500">
                        If previous session is still closing, this auto-recovers within ~30s.
                    </p>
                </div>
            )}

            {/* ERROR — retry */}
            {status === 'error' && (
                <div className="mb-5">
                    <button
                        onClick={reconnect}
                        className="w-full px-4 py-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                    >
                        <RefreshCw size={16} />
                        Retry Connection
                    </button>
                </div>
            )}

            {/* ACTIVE — URL card */}
            {status === 'active' && url && (
                <div className="space-y-4">
                    <div className="p-5 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-xl">
                        <div className="flex items-center gap-2 mb-3">
                            <CheckCircle size={18} className="text-emerald-400 shrink-0" />
                            <span className="text-sm font-semibold text-emerald-300">Permanent Backend URL</span>
                        </div>
                        <div className="flex items-stretch gap-2">
                            <code className="flex-1 bg-slate-900/80 px-4 py-3.5 rounded-lg text-emerald-300 font-mono text-sm break-all border border-emerald-500/20 leading-relaxed">
                                {url}
                            </code>
                            <button
                                onClick={() => handleCopy(url)}
                                className={`px-4 rounded-lg font-medium text-sm flex flex-col items-center justify-center gap-1 transition-all min-w-[64px] border ${
                                    copied
                                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                                        : 'bg-slate-700 border-white/[0.08] hover:bg-slate-600 text-slate-200'
                                }`}
                                title="Copy URL"
                            >
                                {copied ? <Check size={18} /> : <Copy size={18} />}
                                <span className="text-xs">{copied ? 'Copied!' : 'Copy'}</span>
                            </button>
                        </div>
                        <p className="mt-2.5 text-xs text-slate-400">
                            This URL never changes. Mobile app already points here — no configuration needed.
                        </p>
                    </div>

                    <div className="flex items-center gap-4 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                        <QrCode size={24} className="text-indigo-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-indigo-300 font-medium">QR Code</p>
                            <p className="text-xs text-indigo-400/80 mt-0.5">Scan to open URL on phone.</p>
                        </div>
                        <a
                            href={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0"
                        >
                            <ExternalLink size={12} />
                            View QR
                        </a>
                    </div>

                    <button
                        onClick={reconnect}
                        className="w-full px-4 py-2.5 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                    >
                        <RefreshCw size={16} />
                        Reconnect Tunnel
                    </button>
                </div>
            )}

            {/* How it works */}
            <div className="mt-6 pt-5 border-t border-white/[0.06]">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-slate-800 text-slate-400 flex items-center justify-center text-xs">?</span>
                    How It Works
                </h3>
                <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="p-3 bg-slate-800/40 rounded-lg">
                        <div className="font-medium text-slate-300 mb-1">1. Desktop App</div>
                        <div className="text-slate-500">Opens secure reverse tunnel to your VPS on startup</div>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg">
                        <div className="font-medium text-slate-300 mb-1">2. Your VPS</div>
                        <div className="text-slate-500">Serves permanent HTTPS URL that never changes</div>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-lg">
                        <div className="font-medium text-slate-300 mb-1">3. Mobile App</div>
                        <div className="text-slate-500">Connects to permanent URL — zero config needed</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
