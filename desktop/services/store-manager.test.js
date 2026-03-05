const StoreManager = require('./store-manager');

// Mock electron-store
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockCtor = jest.fn().mockImplementation(() => ({
  get: mockGet,
  set: mockSet,
}));

jest.mock('electron-store', () => {
  return mockCtor;
});

describe('StoreManager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup default mock return
        mockGet.mockReturnValue([]);
    });

    test('should initialize with activeAccounts schema', () => {
        new StoreManager();
        expect(mockCtor).toHaveBeenCalledWith(expect.objectContaining({
            schema: expect.objectContaining({
                activeAccounts: expect.anything()
            })
        }));
    });

    test('getAccounts should return the stored array', () => {
        const store = new StoreManager();
        mockGet.mockReturnValue(['acc_1', 'acc_2']);
        
        const accounts = store.getAccounts();
        expect(accounts).toEqual(['acc_1', 'acc_2']);
        expect(mockGet).toHaveBeenCalledWith('activeAccounts');
    });

    test('addAccount should append new account and persist', () => {
        const store = new StoreManager();
        mockGet.mockReturnValue(['acc_1']);
        
        store.addAccount('acc_2');
        
        expect(mockGet).toHaveBeenCalledWith('activeAccounts');
        expect(mockSet).toHaveBeenCalledWith('activeAccounts', ['acc_1', 'acc_2']);
    });

    test('addAccount should ignoring duplicates', () => {
        const store = new StoreManager();
        mockGet.mockReturnValue(['acc_1']);
        
        store.addAccount('acc_1');
        
        expect(mockSet).not.toHaveBeenCalled();
    });

    test('removeAccount should filter account and persist', () => {
        const store = new StoreManager();
        mockGet.mockReturnValue(['acc_1', 'acc_2']);
        
        store.removeAccount('acc_1');
        
        expect(mockSet).toHaveBeenCalledWith('activeAccounts', ['acc_2']);
    });
});
