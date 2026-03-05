
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

  const StatCard = ({ title, value, icon: Icon, bgClass, iconBg, textClass }) => (
    <div className={`rounded-3xl p-6 ${bgClass} border border-white/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}>
        <div className="flex justify-between items-start mb-4">
            <div className={`w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center text-white shadow-sm`}>
                <Icon size={22} strokeWidth={2.5} />
            </div>
        </div>
        <div>
            <h3 className="text-3xl font-bold text-white mb-1">{value}</h3>
            <p className="text-slate-300 font-medium text-sm">{title}</p>
        </div>
    </div>
  );

  return (
    <div className="space-y-8 p-4 h-full flex flex-col overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700/30">
      
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-8 text-white shadow-xl shadow-blue-900/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
              <Sparkles size={120} />
          </div>
          <div className="relative z-10 max-w-2xl">
              <h2 className="text-3xl font-bold mb-2">Welcome back, Admin! 👋</h2>
              <p className="text-blue-100 text-lg opacity-90">Your automated environment is running smoothly. All systems are operational.</p>
          </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <StatCard 
            title="Active Sessions" 
            value={accounts.length} 
            icon={Users} 
            bgClass="bg-slate-800/50 backdrop-blur-md"
            iconBg="bg-blue-500"
            textClass="text-blue-200"
         />
         <StatCard 
            title="Conversations" 
            value={stats.totalConversations.toLocaleString()} 
            icon={Activity} 
            bgClass="bg-slate-800/50 backdrop-blur-md"
            iconBg="bg-emerald-500"
            textClass="text-emerald-200"
         />
         <StatCard 
            title="Unread Messages" 
            value={stats.unreadCount || 0} 
            icon={Bell} 
            bgClass="bg-slate-800/50 backdrop-blur-md"
            iconBg="bg-orange-500"
            textClass="text-orange-200"
         />
      </div>

      {/* System Health */}
      <div className="bg-slate-800/30 backdrop-blur-xl border border-white/5 rounded-3xl p-8">
          <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-slate-700/50 flex items-center justify-center text-slate-300">
                  <Server size={20} />
              </div>
              <div>
                  <h3 className="font-bold text-white text-lg">System Health</h3>
                  <p className="text-slate-400 text-xs">Real-time status monitoring</p>
              </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-slate-800/50 border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                          <Wifi size={18} />
                      </div>
                      <span className="font-medium text-slate-200">Network</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Good
                  </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-800/50 border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
                          <Zap size={18} />
                      </div>
                      <span className="font-medium text-slate-200">Engine</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-full">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      Ready
                  </span>
              </div>

              <div className="p-4 rounded-2xl bg-slate-800/50 border border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                      <div className="p-2 bg-violet-500/10 text-violet-400 rounded-lg">
                          <ShieldCheck size={18} />
                      </div>
                      <span className="font-medium text-slate-200">Bridge</span>
                  </div>
                   <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${window.api ? 'text-emerald-400 bg-emerald-500/10' : 'text-yellow-400 bg-yellow-500/10'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${window.api ? 'bg-emerald-400' : 'bg-yellow-400 animate-pulse'}`} />
                      {window.api ? 'Active' : 'Waiting'}
                  </span>
              </div>
          </div>
      </div>
    </div>
  );
}
