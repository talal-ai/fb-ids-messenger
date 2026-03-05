import React from 'react';
import { Smartphone } from 'lucide-react';

export default function MobileRelay({ onTestMsg }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
      <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
        <Smartphone className="w-10 h-10 text-emerald-400" />
      </div>
      <div>
        <h3 className="text-2xl font-bold text-white mb-2">Relay Server Active</h3>
        <p className="text-slate-400 max-w-md mx-auto">
          Your mobile device acts as a bridge for notifications. Ensure the mobile app is open and permissions are granted.
        </p>
      </div>
      <div className="p-4 bg-slate-900 rounded-lg border border-slate-800 w-full max-w-md text-left">
        <div className="text-xs text-slate-500 uppercase font-bold mb-2">Connection Details</div>
        <div className="flex justify-between text-sm py-1 border-b border-slate-800/50">
          <span className="text-slate-400">Status</span>
          <span className="text-emerald-400 font-medium">Connected</span>
        </div>
        <div className="flex justify-between text-sm py-1 pt-2">
          <span className="text-slate-400">Port</span>
          <span className="text-slate-200">3000</span>
        </div>
      </div>
      <button onClick={onTestMsg} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-all">
        Test Connectivity
      </button>
    </div>
  );
}
