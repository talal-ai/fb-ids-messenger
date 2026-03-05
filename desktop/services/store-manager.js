const Store = require('electron-store');

class StoreManager {
    constructor() {
        this.store = new Store({
            schema: {
                activeAccounts: {
                    type: 'array',
                    default: []
                }
            }
        });
    }

    getAccounts() {
        return this.store.get('activeAccounts');
    }

    addAccount(accountId) {
        const current = this.getAccounts();
        if (!current.includes(accountId)) {
            this.store.set('activeAccounts', [...current, accountId]);
        }
    }

    removeAccount(accountId) {
        const current = this.getAccounts();
        this.store.set('activeAccounts', current.filter(id => id !== accountId));
    }
}

module.exports = StoreManager;
