
import React, { useState } from 'react';
import { Users, Trash2, Monitor, ExternalLink } from 'lucide-react';

export default function ActiveAccounts({ accounts, onAddAccount, onTerminateAccount, onOpenAccount }) {
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
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h3 className="text-xl font-bold text-white">Active Sessions</h3>
            <p className="text-slate-400 text-sm">Manage your persistent FB sessions.</p>
        </div>
        
        <button 
            onClick={() => setIsAdding(!isAdding)} 
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl shadow-lg shadow-blue-900/20 transition-all flex items-center gap-2"
        >
            <Users size={18} />
            {isAdding ? 'Cancel' : 'Add New Account'}
        </button>
      </div>

      {/* Add Account Form */}
      {isAdding && (
          <div className="bg-slate-800/50 border border-blue-500/30 rounded-2xl p-6 mb-6 animate-fade-in">
              <h4 className="text-white font-medium mb-4">Launch New Session</h4>
              <form onSubmit={handleSubmit} className="flex gap-4">
                  <input 
                    type="text" 
                    placeholder="Enter nickname (e.g. 'Personal', 'Business')" 
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none"
                    value={nickname}
                    onChange={e => setNickname(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl">
                      Launch Browser
                  </button>
              </form>
          </div>
      )}

      {/* Account List */}
      {(!accounts || accounts.length === 0) ? (
        <div className="text-center py-20 bg-slate-900/30 border border-dashed border-slate-800 rounded-3xl">
          <Users size={48} className="mx-auto text-slate-600 mb-4" />
          <p className="text-slate-400 font-medium">No active sessions.</p>
          <p className="text-slate-500 text-sm mt-1">Click "Add New Account" to start.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div key={acc.id} className="bg-slate-900/60 backdrop-blur border border-white/5 p-5 rounded-2xl hover:border-blue-500/30 transition-all group relative">
                <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-white text-lg truncate">{acc.fb_name || acc.nickname || 'Session'}</h4>
                        {acc.fb_name && acc.nickname && (
                            <p className="text-xs text-slate-400 mt-0.5">{acc.nickname}</p>
                        )}
                        <p className="text-xs text-slate-500 font-mono mt-1 truncate">{acc.id}</p>
                        {acc.fb_user_id && (
                            <p className="text-xs text-blue-400/60 font-mono mt-0.5">FB: {acc.fb_user_id}</p>
                        )}
                    </div>
                    <div className={`shrink-0 ml-2 px-2 py-1 rounded-md text-xs font-medium border flex items-center gap-1 ${
                        acc.status === 'active' || acc.status === 'online'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : acc.status === 'needs_login' 
                            ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                            : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                        <Monitor size={12} /> {acc.status || 'offline'}
                    </div>
                </div>
                
                <div className="flex gap-2 mt-4 pt-4 border-t border-white/5">
                    <button 
                        onClick={() => onOpenAccount && onOpenAccount(acc.id)}
                        className="flex-1 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                        title="Open visible browser window"
                    >
                        <ExternalLink size={16} /> Open
                    </button>
                    <button 
                        onClick={() => onTerminateAccount(acc.id)}
                        className="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                        title="Terminate Session"
                    >
                        <Trash2 size={16} /> Terminate
                    </button>
                </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
