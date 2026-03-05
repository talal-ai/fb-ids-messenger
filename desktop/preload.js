
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Accounts
    getAccounts: () => ipcRenderer.invoke('accounts:list'),
    addAccount: (nickname) => ipcRenderer.invoke('accounts:add', nickname),
    deleteAccount: (id) => ipcRenderer.invoke('accounts:delete', id),
    openAccount: (id) => ipcRenderer.invoke('accounts:open', id),

    // Settings
    getSetting: (key) => ipcRenderer.invoke('settings:get', key),
    saveSetting: (key, value) => ipcRenderer.invoke('settings:save', key, value),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),


    // Stats
    getStats: () => ipcRenderer.invoke('stats:get-summary'),
    
    // Notifications
    getNotifications: () => ipcRenderer.invoke('notifications:get'),
    clearNotifications: () => ipcRenderer.invoke('notifications:clear'),
    onNewNotification: (callback) => ipcRenderer.on('new-message-notification', (e, data) => callback(data)),
    onAccountsUpdated: (callback) => ipcRenderer.on('accounts-updated', () => callback()),

    // Telegram test
    testTelegram: () => ipcRenderer.invoke('telegram:test'),
    detectTelegramChat: () => ipcRenderer.invoke('telegram:detect-chat')
});
