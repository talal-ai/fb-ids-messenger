
import React, { useState } from 'react';
import { Users, Trash2, Monitor, ExternalLink } from 'lucide-react';

export default function ActiveAccounts({ accounts, onAddAccount, onTerminateAccount, onOpenAccount, accountError, onDismissAccountError }) {
  const [nickname, setNickname] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleSubmit = (e) => {
      e.preventDefault();
      if (!nickname.trim()) return;
      onAddAccount(nickname);
      setNickname('');
      setIsAdding(false);
  };

  return (
    <div className="space-y-5 p-1">
      {accountError && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <span>{accountError}</span>
          <button type="button" onClick={onDismissAccountError} className="shrink-0 px-2 py-1 rounded-lg hover:bg-red-500/20 transition-colors" aria-label="Dismiss">×</button>
        </div>
      )}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Active Sessions</h3>
          <p className="text-slate-500 text-sm mt-0.5">Manage your persistent FB sessions</p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl shadow-accent transition-all flex items-center gap-2 focus-ring"
        >
          <Users size={18} />
          {isAdding ? 'Cancel' : 'Add New Account'}
        </button>
      </div>

      {isAdding && (
        <div className="rounded-2xl bg-slate-900/50 border border-blue-500/20 p-5 animate-fade-in">
          <h4 className="text-white font-medium text-sm mb-3">Launch New Session</h4>
          <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Profile Name (e.g. Personal, Business, Client-A)"
              className="flex-1 min-w-[200px] bg-slate-800/80 border border-white/[0.08] rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-colors"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoFocus
            />
            <button type="submit" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors">
              Launch Browser
            </button>
          </form>
        </div>
      )}

      {(!accounts || accounts.length === 0) ? (
        <div className="text-center py-16 rounded-2xl bg-slate-900/30 border border-dashed border-white/[0.08]">
          <div className="w-14 h-14 rounded-2xl bg-slate-800/80 flex items-center justify-center mx-auto mb-4 text-slate-500">
            <Users size={28} />
          </div>
          <p className="text-slate-400 font-medium">No active sessions</p>
          <p className="text-slate-500 text-sm mt-1">Click “Add New Account” to start a session.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              className="rounded-2xl bg-slate-900/50 backdrop-blur-sm border border-white/[0.06] p-5 shadow-glass transition-all duration-200 hover:border-white/[0.08] hover:shadow-glass-hover"
            >
              <div className="flex justify-between items-start gap-3 mb-4">
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-white truncate">{acc.nickname || acc.fb_name || 'Session'}</h4>
                  {acc.fb_name && acc.fb_name !== acc.nickname && <p className="text-xs text-slate-500 mt-0.5 truncate">FB: {acc.fb_name}</p>}
                  <p className="text-[11px] text-slate-600 font-mono mt-1 truncate">{acc.id}</p>
                  {acc.fb_user_id && <p className="text-[11px] text-blue-400/70 font-mono mt-0.5 truncate">FB ID: {acc.fb_user_id}</p>}
                </div>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${
                    acc.status === 'active' || acc.status === 'online'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : acc.status === 'needs_login'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  }`}
                >
                  <Monitor size={12} /> {acc.status || 'offline'}
                </span>
              </div>
              <div className="flex gap-2 pt-4 border-t border-white/[0.06]">
                <button
                  onClick={() => onOpenAccount?.(acc.id)}
                  className="flex-1 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors focus-ring"
                  title="Open browser window"
                >
                  <ExternalLink size={14} /> Open
                </button>
                <button
                  onClick={() => onTerminateAccount(acc.id)}
                  className="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors focus-ring"
                  title="Terminate session"
                >
                  <Trash2 size={14} /> Terminate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
