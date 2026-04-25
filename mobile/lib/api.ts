import { getServerUrl, getApiToken } from './storage';
import type { Account, Conversation, Message, ReplyCommand } from './types';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const baseUrl = await getServerUrl();
    const token = await getApiToken();

    if (!baseUrl) throw new Error('Server URL not configured');
    if (!token) throw new Error('API token not configured');

    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();
    if (!res.ok && !json.ok) {
        throw new Error(json.detail || json.code || `HTTP ${res.status}`);
    }
    return json as T;
}

export async function fetchAccounts(): Promise<Account[]> {
    const res = await request<{ ok: boolean; accounts: Account[] }>('GET', '/v1/accounts');
    return res.accounts;
}

export async function fetchConversations(accountId?: string): Promise<Conversation[]> {
    const params = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
    const res = await request<{ ok: boolean; conversations: Conversation[] }>(
        'GET',
        `/v1/conversations${params}`
    );
    return res.conversations;
}

export async function fetchMessages(conversationId: string, before?: number): Promise<Message[]> {
    const params = before ? `?before=${before}` : '';
    const res = await request<{ ok: boolean; messages: Message[] }>(
        'GET',
        `/v1/conversations/${encodeURIComponent(conversationId)}/messages${params}`
    );
    return res.messages;
}

export async function sendReply(payload: ReplyCommand): Promise<{ ok: boolean; reply_job_id?: number }> {
    return await request('POST', '/v1/reply-commands', payload);
}

export async function registerDeviceToken(token: string, platform: 'ios' | 'android' = 'ios'): Promise<void> {
    await request('POST', '/v1/device-tokens', { token, platform });
}

export async function markRead(conversationId: string): Promise<void> {
    await request('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/mark-read`);
}

export async function syncConversation(conversationId: string, accountId: string): Promise<{ ok: boolean; count?: number }> {
    return await request('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/sync`, {
        account_id: accountId,
    });
}

export async function testConnection(): Promise<boolean> {
    try {
        const baseUrl = await getServerUrl();
        const res = await fetch(`${baseUrl}/health`);
        const json = await res.json();
        return json.ok === true;
    } catch {
        return false;
    }
}
