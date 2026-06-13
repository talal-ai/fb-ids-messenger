
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
    resetTelegramSettings: () => ipcRenderer.invoke('settings:reset-telegram'),


    // Stats
    getStats: () => ipcRenderer.invoke('stats:get-summary'),
    
    // Notifications
    getNotifications: () => ipcRenderer.invoke('notifications:get'),
    clearNotifications: () => ipcRenderer.invoke('notifications:clear'),
    onNewNotification: (callback) => ipcRenderer.on('new-message-notification', (e, data) => callback(data)),
    onAccountsUpdated: (callback) => ipcRenderer.on('accounts-updated', () => callback()),

    // Telegram test
    testTelegram: () => ipcRenderer.invoke('telegram:test'),
    detectTelegramChat: () => ipcRenderer.invoke('telegram:detect-chat'),

    // App metadata
    getAppVersion: () => ipcRenderer.invoke('app:version'),

    // Auto updater
    getUpdaterState: () => ipcRenderer.invoke('updater:get-state'),
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    installUpdate: () => ipcRenderer.invoke('updater:install'),
    onUpdaterState: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('updater:state', listener);
        return () => ipcRenderer.removeListener('updater:state', listener);
    },
    onControlPlaneStatus: (callback) => {
        const listener = (_event, status) => callback(status);
        ipcRenderer.on('control-plane:status', listener);
        return () => ipcRenderer.removeListener('control-plane:status', listener);
    },

    // Cloud Access (permanent FRP reverse tunnel to VPS)
    getCloudStatus: () => ipcRenderer.invoke('cloud:get-status'),
    enableCloud: () => ipcRenderer.invoke('cloud:enable'),
    disableCloud: () => ipcRenderer.invoke('cloud:disable'),
    getCloudUrl: () => ipcRenderer.invoke('cloud:get-url'),
    onCloudProgress: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('cloud:progress', listener);
        return () => ipcRenderer.removeListener('cloud:progress', listener);
    }
});
