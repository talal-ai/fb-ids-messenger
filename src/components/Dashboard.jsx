
import React, { useEffect, useState } from 'react';
import { Users, Activity, MessageSquare, Zap, Server, ShieldCheck, Wifi, Sparkles, Bell } from 'lucide-react';

export default function Dashboard({ accounts }) {
  const [stats, setStats] = useState({
    totalMessages: 0,
    totalConversations: 0,
    activeAccounts: 0,
    unreadCount: 0
  });

  useEffect(() => {
    if (window.api) {
        window.api.getStats().then(s => {
            if (s) setStats(s);
        });
        const interval = setInterval(() => {
             window.api.getStats().then(s => {
                if (s) setStats(s);
            });
        }, 5000);
        return () => clearInterval(interval);
    }
  }, []);

  const StatCard = ({ title, value, icon: Icon, iconBg }) => (
    <div className="rounded-2xl p-5 bg-slate-900/50 backdrop-blur-sm border border-white/[0.06] shadow-glass transition-all duration-200 hover:shadow-glass-hover hover:border-white/[0.08]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-slate-400 text-sm font-medium mb-1">{title}</p>
          <p className="text-2xl font-semibold text-white tabular-nums">{value}</p>
        </div>
        <div className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center text-white shrink-0`}>
          <Icon size={20} strokeWidth={2.5} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-1">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 p-6 text-white shadow-glass relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 translate-x-1/3 -translate-y-1/3 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-0 left-0 w-48 h-48 -translate-x-1/2 translate-y-1/2 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Sparkles size={24} strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-0.5">Welcome back, Admin</h2>
            <p className="text-blue-100/90 text-sm">Your automated environment is running. All systems operational.</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Active Sessions" value={accounts.length} icon={Users} iconBg="bg-blue-500" />
        <StatCard title="Conversations" value={stats.totalConversations.toLocaleString()} icon={Activity} iconBg="bg-emerald-500" />
        <StatCard title="Unread Messages" value={stats.unreadCount || 0} icon={Bell} iconBg="bg-amber-500" />
      </div>

      {/* System Health */}
      <div className="rounded-2xl bg-slate-900/40 backdrop-blur-sm border border-white/[0.06] p-6 shadow-glass">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-slate-800/80 flex items-center justify-center text-slate-400">
            <Server size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-white text-base">System Health</h3>
            <p className="text-slate-500 text-xs mt-0.5">Real-time status</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl bg-slate-800/50 border border-white/[0.04] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400">
                <Wifi size={16} />
              </div>
              <span className="font-medium text-slate-200 text-sm">Network</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Good
            </span>
          </div>
          <div className="p-4 rounded-xl bg-slate-800/50 border border-white/[0.04] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-blue-500/15 text-blue-400">
                <Zap size={16} />
              </div>
              <span className="font-medium text-slate-200 text-sm">Engine</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 px-2 py-1 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              Ready
            </span>
          </div>
          <div className="p-4 rounded-xl bg-slate-800/50 border border-white/[0.04] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-violet-500/15 text-violet-400">
                <ShieldCheck size={16} />
              </div>
              <span className="font-medium text-slate-200 text-sm">Bridge</span>
            </div>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg ${window.api ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${window.api ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              {window.api ? 'Active' : 'Waiting'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
