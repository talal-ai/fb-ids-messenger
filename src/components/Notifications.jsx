
import React, { useState, useEffect } from 'react';
import { Bell, Trash2, MessageCircle, Clock } from 'lucide-react';

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'

  // Load stored notifications on mount
  useEffect(() => {
    if (window.api) {
      window.api.getNotifications().then(stored => {
        setNotifications(stored || []);
      });

      // Listen for real-time notifications
      window.api.onNewNotification((notif) => {
        setNotifications(prev => [{
          id: Date.now() + Math.random(),
          ...notif,
          read: false,
          timestamp: Date.now()
        }, ...prev].slice(0, 200));
      });
    }
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const filtered = filter === 'unread' 
    ? notifications.filter(n => !n.read) 
    : notifications;

  const handleMarkRead = (id) => {
    // Only local state update for now
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const handleClearAll = () => {
    if (window.api) window.api.clearNotifications();
    setNotifications([]);
  };

  const timeAgo = (ts) => {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-slate-200">Notifications</h3>
          {unreadCount > 0 && (
            <span className="px-2.5 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full animate-pulse">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter(filter === 'all' ? 'unread' : 'all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === 'unread'
                ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {filter === 'unread' ? 'Show All' : `Unread (${unreadCount})`}
          </button>
          <button
            onClick={handleClearAll}
            className="px-3 py-1.5 bg-slate-800 hover:bg-red-900/30 text-slate-400 hover:text-red-400 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
          >
            <Trash2 size={12} /> Clear All
          </button>
        </div>
      </div>

      {/* Notification List */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-20 text-slate-600">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No notifications yet</p>
            <p className="text-xs mt-1 text-slate-700">Messages from your accounts will appear here</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700/50">
          {filtered.map((notif) => (
            <div
              key={notif.id}
              onClick={() => handleMarkRead(notif.id)}
              className={`p-4 rounded-xl border transition-all cursor-pointer group ${
                notif.read
                  ? 'bg-slate-900/40 border-slate-800/50 hover:border-slate-700'
                  : 'bg-slate-900 border-blue-500/30 hover:border-blue-500/50 shadow-lg shadow-blue-900/10'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Avatar / Icon */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  notif.read ? 'bg-slate-800' : 'bg-blue-600/20'
                }`}>
                    <MessageCircle className={`w-5 h-5 ${notif.read ? 'text-slate-500' : 'text-blue-400'}`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                     <span className={`text-sm font-semibold truncate ${notif.read ? 'text-slate-400' : 'text-white'}`}>
                      {notif.sender_name || notif.senderName || 'Unknown'}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Clock size={10} className="text-slate-500" />
                      <span className="text-[10px] text-slate-500 font-mono">{timeAgo(notif.timestamp)}</span>
                    </div>
                  </div>
                  <p className={`text-xs mt-0.5 truncate ${notif.read ? 'text-slate-500' : 'text-slate-300'}`}>
                    {notif.messagePreview || notif.body || '(no preview)'}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">
                      {notif.accountNickname || notif.accountId || 'unknown'}
                    </span>
                    {notif.detectedBy && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded">
                        via {notif.detectedBy}
                      </span>
                    )}
                    {!notif.read && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full ml-auto animate-pulse" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
