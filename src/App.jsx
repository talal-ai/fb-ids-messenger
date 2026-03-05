
import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Settings, Bell, LogOut, Plus, RefreshCw, X, Activity, Users, Smartphone } from 'lucide-react';
import Logo from './components/Logo';
import Dashboard from './components/Dashboard';
import ActiveAccounts from './components/ActiveAccounts';
import TelegramSettings from './components/TelegramSettings';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    if (window.api) {
      // Load accounts on mount
      window.api.getAccounts().then((accs) => {
        setAccounts(accs || []);
      });

      // Refresh account list when identity is detected in background
      window.api.onAccountsUpdated(() => {
         window.api.getAccounts().then((accs) => setAccounts(accs || []));
      });
    }
  }, []);

  const refreshAccounts = async () => {
      if (window.api) {
          const accs = await window.api.getAccounts();
          setAccounts(accs);
      }
  };

  const handleAddAccount = async (nickname) => {
      if (window.api) {
          await window.api.addAccount(nickname);
          refreshAccounts();
      }
  };
  
  const handleTerminateAccount = async (id) => {
      if (window.api) {
          await window.api.deleteAccount(id);
          refreshAccounts();
      }
  };

  const handleOpenAccount = async (id) => {
      if (window.api) {
          await window.api.openAccount(id);
      }
  };

  return (
    <div className="flex h-screen bg-[#0B0F19] text-slate-200 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-900/10 rounded-full blur-[120px]" />
      </div>

      {/* Floating Sidebar */}
      <div className="w-20 lg:w-72 p-4 flex flex-col z-20 relative">
        <div className="flex-1 bg-slate-900/60 backdrop-blur-xl border border-white/5 rounded-3xl flex flex-col shadow-2xl">
            {/* Logo Area */}
            <div className="p-6 flex items-center justify-center lg:justify-start gap-4 border-b border-white/5">
                <Logo className="w-12 h-12 shrink-0" />
                <div className="hidden lg:block">
                    <h1 className="font-heading font-bold text-lg tracking-tight text-white leading-tight">Multi‑FB Manager</h1>
                    <p className="text-[10px] text-slate-400 font-medium tracking-wider uppercase">Facebook Accounts</p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-2 mt-2">
            {[
                { id: 'dashboard', label: 'Dashboard', icon: Activity },
                { id: 'accounts', label: 'Active Sessions', icon: Users },
                { id: 'settings', label: 'Telegram Setup', icon: Smartphone },
            ].map(item => (
                <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-4 p-3.5 rounded-2xl transition-all duration-300 group relative overflow-hidden ${
                    activeTab === item.id 
                    ? 'bg-blue-600 shadow-lg shadow-blue-900/40 text-white' 
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
                >
                <item.icon className={`w-5 h-5 transition-transform group-hover:scale-110 ${activeTab === item.id ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} strokeWidth={activeTab === item.id ? 2.5 : 2} />
                <span className={`hidden lg:block font-medium tracking-wide ${activeTab === item.id ? 'font-semibold' : ''}`}>{item.label}</span>
                {item.badge > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] text-center">{item.badge > 99 ? '99+' : item.badge}</span>
                )}
                {/* Active Indicator Glow */}
                {activeTab === item.id && <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent pointer-events-none" />}
                </button>
            ))}
            </nav>

            {/* User Profile / Status */}
            <div className="p-4 border-t border-white/5 mx-2 mb-2">
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-400 shadow-lg shadow-emerald-900/20 flex items-center justify-center">
                        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    </div>
                    <div className="hidden lg:block min-w-0">
                        <div className="text-xs font-semibold text-slate-200">System Online</div>
                        <div className="text-[10px] text-emerald-400 font-mono">v2.0.0 Playwright</div>
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10 py-4 pr-4">
         {/* Top Header - Floating Glass */}
         <header className="h-20 flex items-center justify-between px-8 mb-4 bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-3xl mx-2 shadow-xl">
            <div>
               <h2 className="text-2xl font-heading font-bold text-white tracking-tight">{
                   activeTab === 'dashboard' ? 'Overview' : 
                   activeTab === 'accounts' ? 'Session Manager' : 
                   activeTab === 'settings' ? 'Telegram Configuration' : ''
               }</h2>
               <p className="text-xs text-slate-400 mt-1">Manage your automated FB environment</p>
            </div>
            
            <div className="flex items-center gap-4">
                <div className="px-4 py-2 rounded-xl bg-slate-800/50 border border-white/5 flex items-center gap-3">
                   <div className="flex -space-x-2">
                      {accounts.slice(0,3).map((acc, i) => (
                          <div key={acc.id} className="w-6 h-6 rounded-full bg-slate-700 border-2 border-slate-800 flex items-center justify-center text-[8px] text-slate-400">
                              {acc.nickname?.[0] || 'U'}
                          </div>
                      ))}
                   </div>
                   <span className="text-xs text-slate-400 font-medium pl-1">{accounts.length} Active</span>
                </div>
            </div>
         </header>

         {/* Content Wrapper */}
         <main className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700/50 hover:scrollbar-thumb-slate-600/50">
           <div className="h-full">
               {activeTab === 'dashboard' && <Dashboard accounts={accounts} />}
               {activeTab === 'accounts' && (
                 <ActiveAccounts 
                    accounts={accounts} 
                    onAddAccount={handleAddAccount}
                    onTerminateAccount={handleTerminateAccount}
                    onOpenAccount={handleOpenAccount}
                 />
               )}
               {activeTab === 'settings' && <TelegramSettings />}
           </div>
         </main>
      </div>
    </div>
  );
}

export default App;
