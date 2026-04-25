export interface Account {
    id: string;
    nickname: string;
    fb_name: string | null;
    fb_user_id: string | null;
    status: 'active' | 'needs_login' | 'offline';
    created_at: number;
}

export interface Conversation {
    id: string;
    account_id: string;
    participant_name: string | null;
    last_message: string | null;
    last_message_at: number;
    unread_count: number;
    account_label: string;
    account_fb_user_id: string | null;
}

export interface Message {
    id: string;
    conversation_id: string;
    account_id: string;
    sender_name: string | null;
    body: string | null;
    timestamp: number;
    is_outgoing: number;
}

export interface ReplyCommand {
    reply_id: string;
    idempotency_key: string;
    event_id: string | null;
    account_id: string;
    conversation_id: string;
    message_raw: string;
    expected_conversation_version: null;
    created_at: number;
}

export interface ApiResponse<T> {
    ok: boolean;
    [key: string]: T | boolean | string | undefined;
}
