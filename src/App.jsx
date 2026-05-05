
import React, { useState, useEffect } from 'react';
import { Activity, Users, Smartphone, RefreshCw, Download, RotateCcw, Globe } from 'lucide-react';
import Logo from './components/Logo';
import Dashboard from './components/Dashboard';
import ActiveAccounts from './components/ActiveAccounts';
import TelegramSettings from './components/TelegramSettings';
import CloudAccess from './components/CloudAccess';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);
  const [accountError, setAccountError] = useState(null);
  const [appVersion, setAppVersion] = useState('0.0.0');
  const [updater, setUpdater] = useState({
    status: 'idle',
    message: 'Idle',
    updateInfo: null,
    progress: null,
    checkedAt: null,
    error: null
  });

  useEffect(() => {
    if (window.api) {
      // Load accounts on mount
      window.api.getAccounts().then((accs) => {
        setAccounts(accs || []);
      });

      window.api.getAppVersion().then((version) => setAppVersion(version || '0.0.0'));

      window.api.getUpdaterState().then((state) => {
        if (state) setUpdater(state);
      });

      const unsubscribeUpdater = window.api.onUpdaterState((state) => {
        if (state) setUpdater(state);
      });

      // Refresh account list when identity is detected in background
      window.api.onAccountsUpdated(() => {
         window.api.getAccounts().then((accs) => setAccounts(accs || []));
      });

      return () => {
        if (typeof unsubscribeUpdater === 'function') unsubscribeUpdater();
      };
    }
  }, []);

  const refreshAccounts = async () => {
      if (window.api) {
          const accs = await window.api.getAccounts();
          setAccounts(accs);
      }
  };

  const handleAddAccount = async (nickname) => {
      if (!window.api) return;
      setAccountError(null);
      const result = await window.api.addAccount(nickname);
      if (result?.error) {
          setAccountError(result.error);
          return;
      }
      refreshAccounts();
  };

  const handleTerminateAccount = async (id) => {
      if (!window.api) return;
      setAccountError(null);
      const result = await window.api.deleteAccount(id);
      if (result?.error) {
          setAccountError(result.error);
          return;
      }
      refreshAccounts();
  };

  const handleOpenAccount = async (id) => {
      if (!window.api) return;
      setAccountError(null);
      const result = await window.api.openAccount(id);
      if (result?.error) {
          setAccountError(result.error);
          return;
      }
  };

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const formatSpeed = (bytesPerSecond) => {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s';
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  const isChecking = updater.status === 'checking';
  const isDownloading = updater.status === 'downloading';
  const canDownload = updater.status === 'available';
  const canRestart = updater.status === 'downloaded';
  const isUpToDate = updater.status === 'not-available';
  const progressPercent = Number.isFinite(updater.progress?.percent) ? updater.progress.percent : 0;

  const statusToneClass =
    canDownload || canRestart
      ? 'text-blue-300'
      : isUpToDate
      ? 'text-emerald-400'
      : updater.status === 'error'
      ? 'text-rose-400'
      : 'text-slate-400';

  // Hide dev-facing "feed not published yet" state from end users — keep it
  // logged via electron-log but render the footer as a neutral idle state.
  const displayMessage =
    updater.status === 'misconfigured' ? 'Idle' : updater.message || 'Idle';

  const handleCheckUpdates = async () => {
    if (!window.api) return;
    await window.api.checkForUpdates();
  };

  const handleDownloadUpdate = async () => {
    if (!window.api) return;
    await window.api.downloadUpdate();
  };

  const handleInstallUpdate = async () => {
    if (!window.api) return;
    await window.api.installUpdate();
  };

  return (
    <div className="flex h-screen bg-[var(--bg-base)] text-slate-200 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-15%] left-[-5%] w-[50%] h-[50%] bg-blue-950/20 rounded-full blur-[140px]" />
        <div className="absolute bottom-[-15%] right-[-5%] w-[45%] h-[45%] bg-indigo-950/15 rounded-full blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(59,130,246,0.06),transparent)]" />
      </div>

      {/* Sidebar */}
      <aside className="w-20 lg:w-64 shrink-0 p-3 flex flex-col z-20 relative">
        <div className="flex-1 flex flex-col rounded-2xl bg-slate-900/50 backdrop-blur-xl border border-white/[0.06] shadow-glass min-h-0">
          <div className="p-5 flex items-center justify-center lg:justify-start gap-3 border-b border-white/[0.06]">
            <Logo className="w-10 h-10 shrink-0" />
            <div className="hidden lg:block min-w-0">
              <h1 className="font-semibold text-base tracking-tight text-white truncate">Multi‑FB Manager</h1>
              <p className="text-[10px] text-slate-500 font-medium tracking-wider uppercase mt-0.5">Facebook Accounts</p>
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1 min-h-0 overflow-y-auto">
            {[
{ id: 'dashboard', label: 'Dashboard', icon: Activity },
              { id: 'accounts', label: 'Active Sessions', icon: Users },
              { id: 'cloud', label: 'Cloud Access', icon: Globe },
              { id: 'settings', label: 'API Settings', icon: Smartphone },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative focus-ring ${
                  activeTab === item.id
                    ? 'bg-blue-600 text-white shadow-accent'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
                }`}
              >
                <item.icon className="w-5 h-5 shrink-0" strokeWidth={activeTab === item.id ? 2.5 : 2} />
                <span className="hidden lg:block font-medium text-sm truncate">{item.label}</span>
                {item.badge > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-semibold rounded-md min-w-[18px] text-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </button>
            ))}

            <button
              onClick={handleCheckUpdates}
              disabled={isChecking || isDownloading}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative text-slate-400 hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-5 h-5 shrink-0 ${isChecking ? 'animate-spin' : ''}`} strokeWidth={2} />
              <span className="hidden lg:block font-medium text-sm truncate">Check Updates</span>
            </button>
          </nav>

          <div className="p-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.04]">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
              </div>
              <div className="hidden lg:block min-w-0">
                <div className="text-xs font-medium text-slate-200 truncate">System Online</div>
                <div className="text-[10px] text-emerald-500/90 font-mono">v{appVersion}</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10 py-4 pr-4 pl-1">
        <header className="h-16 shrink-0 flex items-center justify-between px-6 mb-4 rounded-2xl bg-slate-900/40 backdrop-blur-xl border border-white/[0.06] shadow-glass mx-2">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-white tracking-tight truncate">
{activeTab === 'dashboard' ? 'Overview' : activeTab === 'accounts' ? 'Session Manager' : activeTab === 'cloud' ? 'Cloud Access' : activeTab === 'settings' ? 'API & Telegram Setup' : ''}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage your automated FB environment</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/[0.06] flex items-center gap-2">
              <div className="flex -space-x-1.5">
                {accounts.slice(0, 3).map((acc) => (
                  <div key={acc.id} className="w-6 h-6 rounded-full bg-slate-700 border-2 border-slate-800 flex items-center justify-center text-[10px] font-medium text-slate-400">
                    {(acc.nickname || acc.fb_name || 'U')[0]}
                  </div>
                ))}
              </div>
              <span className="text-xs text-slate-500 font-medium">{accounts.length} active</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 min-h-0">
          {activeTab === 'dashboard' && <Dashboard accounts={accounts} />}
          {activeTab === 'accounts' && (
            <ActiveAccounts
              accounts={accounts}
              onAddAccount={handleAddAccount}
              onTerminateAccount={handleTerminateAccount}
              onOpenAccount={handleOpenAccount}
              accountError={accountError}
              onDismissAccountError={() => setAccountError(null)}
            />
          )}
          {activeTab === 'settings' && <TelegramSettings />}
          {activeTab === 'cloud' && <CloudAccess />}
        </main>

        <footer className="mx-2 mt-2 shrink-0 rounded-2xl bg-slate-900/40 backdrop-blur-xl border border-white/[0.06] shadow-glass px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-200 truncate">Updater</p>
                <p className={`text-[11px] truncate ${statusToneClass}`}>{displayMessage}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {canDownload && (
                  <button
                    onClick={handleDownloadUpdate}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Update
                  </button>
                )}
                {canRestart && (
                  <button
                    onClick={handleInstallUpdate}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restart & Install
                  </button>
                )}
              </div>
            </div>

            {isDownloading && (
              <>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden border border-white/[0.05]">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>{progressPercent.toFixed(1)}%</span>
                  <span>{formatSpeed(updater.progress?.bytesPerSecond)}</span>
                  <span>
                    {formatBytes(updater.progress?.transferred)} / {formatBytes(updater.progress?.total)}
                  </span>
                </div>
              </>
            )}

            {updater.status === 'error' && (
              <p className="text-[11px] text-rose-400 truncate">{updater.error || 'Update failed'}</p>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
