import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SERVER_URL, DEFAULT_API_TOKEN } from './client-config';

const KEYS = {
    SERVER_URL: 'server_url',
    API_TOKEN: 'api_token',
    PUSH_TOKEN: 'expo_push_token',
};

export async function getServerUrl(): Promise<string> {
    const saved = await AsyncStorage.getItem(KEYS.SERVER_URL);
    return saved || DEFAULT_SERVER_URL || '';
}

export async function setServerUrl(url: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.SERVER_URL, url.replace(/\/+$/, ''));
}

export async function getApiToken(): Promise<string> {
    const saved = await AsyncStorage.getItem(KEYS.API_TOKEN);
    return saved || DEFAULT_API_TOKEN || '';
}

export async function setApiToken(token: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.API_TOKEN, token.trim());
}

export async function getPushToken(): Promise<string | null> {
    return await AsyncStorage.getItem(KEYS.PUSH_TOKEN);
}

export async function setPushToken(token: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.PUSH_TOKEN, token);
}

// ── Sender-name cache (keyed by conversation ID) ───────────────────────────
const SENDER_PREFIX = 'sender_name:';

export async function setCachedSenderName(conversationId: string, name: string): Promise<void> {
    if (name && name.trim()) {
        await AsyncStorage.setItem(`${SENDER_PREFIX}${conversationId}`, name.trim());
    }
}

export async function getBulkCachedSenderNames(
    conversationIds: string[]
): Promise<Record<string, string>> {
    if (conversationIds.length === 0) return {};
    const keys = conversationIds.map((id) => `${SENDER_PREFIX}${id}`);
    const pairs = await AsyncStorage.multiGet(keys);
    const result: Record<string, string> = {};
    for (const [key, value] of pairs) {
        if (value) result[key.slice(SENDER_PREFIX.length)] = value;
    }
    return result;
}

// ── Clear all ──────────────────────────────────────────────────────────────
export async function clearAll(): Promise<void> {
    const allKeys = await AsyncStorage.getAllKeys();
    const toRemove = allKeys.filter(
        (k) => Object.values(KEYS).includes(k as any) || k.startsWith(SENDER_PREFIX)
    );
    await AsyncStorage.multiRemove(toRemove);
}
