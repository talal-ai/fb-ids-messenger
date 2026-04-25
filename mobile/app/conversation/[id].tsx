import { useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    FlatList,
    TextInput,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Alert,
    StyleSheet,
    Keyboard,
    Animated,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { fetchMessages, sendReply, markRead, syncConversation } from '@/lib/api';
import type { Message, ReplyCommand } from '@/lib/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    const yest = new Date(now.getTime() - 86400000);
    if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function getInitials(name: string): string {
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

function getDateLabel(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    const yest = new Date(now.getTime() - 86400000);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HeaderTitle({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <View style={{ alignItems: 'center' }}>
            <Text style={hdrStyles.name} numberOfLines={1}>{title}</Text>
            {!!subtitle && <Text style={hdrStyles.sub} numberOfLines={1}>{subtitle}</Text>}
        </View>
    );
}

const hdrStyles = StyleSheet.create({
    name: { fontSize: 16, fontWeight: '700', color: '#111827' },
    sub: { fontSize: 11, color: '#6366F1', marginTop: 1 },
});

function DateSeparator({ label }: { label: string }) {
    return (
        <View style={styles.separator}>
            <View style={styles.sepLine} />
            <Text style={styles.sepLabel}>{label}</Text>
            <View style={styles.sepLine} />
        </View>
    );
}

function MessageBubble({
    item,
    contactName,
    isGrouped,
    isPending,
}: {
    item: Message;
    contactName: string;
    isGrouped: boolean;
    isPending: boolean;  // ← explicitly passed, not guessed from ID format
}) {
    const isOut = item.is_outgoing === 1;

    return (
        <View style={[styles.msgRow, isOut ? styles.msgRowOut : styles.msgRowIn]}>
            {/* Incoming avatar — hidden when grouped with next msg */}
            {!isOut && (
                <View style={[styles.avatar, isGrouped && styles.avatarHidden]}>
                    {!isGrouped && (
                        <Text style={styles.avatarText}>
                            {getInitials(item.sender_name || contactName)}
                        </Text>
                    )}
                </View>
            )}

            <View
                style={[
                    styles.bubble,
                    isOut ? styles.bubbleOut : styles.bubbleIn,
                    isGrouped && (isOut ? styles.bubbleGroupedOut : styles.bubbleGroupedIn),
                ]}
            >
                {/* Sender label for first in a group */}
                {!isOut && !isGrouped && (
                    <Text style={styles.senderLabel}>
                        {item.sender_name || contactName}
                    </Text>
                )}

                <Text style={[styles.bodyText, isOut && styles.bodyTextOut]}>
                    {item.body ?? ''}
                </Text>

                {/* Timestamp & status row */}
                <View style={styles.metaRow}>
                    <Text style={[styles.timeText, isOut && styles.timeTextOut]}>
                        {formatTime(item.timestamp)}
                    </Text>
                    {isOut && (
                        <Text style={styles.tickText}>
                            {isPending ? '⏱' : '✓✓'}
                        </Text>
                    )}
                </View>
            </View>
        </View>
    );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ConversationScreen() {
    const { id, accountId, senderName, accountLabel } = useLocalSearchParams<{
        id: string;
        accountId: string;
        senderName?: string;
        accountLabel?: string;
    }>();
    const navigation = useNavigation();

    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [bottomPad, setBottomPad] = useState(0);
    // Track which message IDs are in-flight (⏱). Cleared the moment sendReply() resolves.
    const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

    const flatListRef = useRef<FlatList>(null);
    const inputRef = useRef<TextInput>(null);

    // ── Keyboard padding (Android) ─────────────────────────────────────────────
    useEffect(() => {
        if (Platform.OS !== 'android') return;
        const show = Keyboard.addListener('keyboardDidShow', (e) => {
            setBottomPad(e.endCoordinates.height);
        });
        const hide = Keyboard.addListener('keyboardDidHide', () => {
            setBottomPad(0);
        });
        return () => { show.remove(); hide.remove(); };
    }, []);

    // ── Merge helpers ──────────────────────────────────────────────────────────
    const mergeMessages = useCallback(
        (prev: Message[], incoming: Message[]): Message[] => {
            const ids = new Set(incoming.map((m) => m.id));
            const bodies = new Set(incoming.map((m) => m.body));
            // Keep pending optimistic messages that server hasn't confirmed yet
            const stillPending = prev.filter(
                (m) =>
                    m.is_outgoing === 1 &&
                    m.id.length === 36 && m.id.includes('-') && // UUID
                    !ids.has(m.id) &&
                    !bodies.has(m.body),
            );
            return [...stillPending, ...incoming].sort((a, b) => b.timestamp - a.timestamp);
        },
        [],
    );

    // ── Focus effect: load + poll ──────────────────────────────────────────────
    useFocusEffect(
        useCallback(() => {
            const title = senderName || 'Conversation';
            const subtitle = accountLabel ? `via ${accountLabel}` : '';

            navigation.setOptions({
                headerTitle: subtitle
                    ? () => <HeaderTitle title={title} subtitle={subtitle} />
                    : title,
            });

            const load = async () => {
                setLoading(true);
                let count = 0;
                try {
                    const data = await fetchMessages(id);
                    setMessages(data);
                    setHasMore(data.length >= 50);
                    count = data.length;
                    markRead(id).catch(() => {});
                } catch (err) {
                    console.error('[Chat] load failed:', err);
                }
                setLoading(false);

                // Background sync if conversation is sparse
                if (count < 10) {
                    try {
                        await syncConversation(id, accountId);
                        const fresh = await fetchMessages(id);
                        setMessages(fresh);
                    } catch (e) {
                        console.warn('[Chat] sync skipped:', e);
                    }
                }
            };

            load();

            const timer = setInterval(async () => {
                try {
                    const latest = await fetchMessages(id);
                    setMessages((prev) => mergeMessages(prev, latest));
                } catch { /* silent */ }
            }, 5000);

            return () => clearInterval(timer);
        }, [id, senderName, accountLabel, accountId, mergeMessages]),
    );

    // ── Load more (older messages) ─────────────────────────────────────────────
    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore || messages.length === 0) return;
        setLoadingMore(true);
        try {
            const oldest = messages[messages.length - 1];
            const older = await fetchMessages(id, oldest.timestamp);
            if (older.length === 0) setHasMore(false);
            else {
                setMessages((prev) => [...prev, ...older]);
                setHasMore(older.length >= 50);
            }
        } catch { /* silent */ }
        setLoadingMore(false);
    }, [loadingMore, hasMore, messages, id]);

    // ── Send message ───────────────────────────────────────────────────────────
    const handleSend = useCallback(async () => {
        const text = inputText.trim();
        if (!text || sending) return;

        const replyId = uuid();
        const optimistic: Message = {
            id: replyId,
            conversation_id: id,
            account_id: accountId,
            sender_name: 'You',
            body: text,
            timestamp: Date.now(),
            is_outgoing: 1,
        };

        setSending(true);
        setInputText('');
        setMessages((prev) => [optimistic, ...prev]);
        // Mark as pending immediately — shows ⏱
        setPendingIds((prev) => new Set(prev).add(replyId));

        const payload: ReplyCommand = {
            reply_id: replyId,
            idempotency_key: `mobile-${replyId}`,
            event_id: null,
            account_id: accountId,
            conversation_id: id,
            message_raw: text,
            expected_conversation_version: null,
            created_at: Date.now(),
        };

        try {
            await sendReply(payload);
            // Server accepted the reply — switch to ✓✓ immediately.
            setPendingIds((prev) => { const s = new Set(prev); s.delete(replyId); return s; });
        } catch (err: any) {
            setMessages((prev) => prev.filter((m) => m.id !== replyId));
            setPendingIds((prev) => { const s = new Set(prev); s.delete(replyId); return s; });
            setInputText(text);
            Alert.alert('Send Failed', err.message || 'Could not send message.');
        }
        setSending(false);
    }, [inputText, sending, accountId, id]);

    // ── Build list with date separators ───────────────────────────────────────
    type ListItem = { type: 'msg'; msg: Message } | { type: 'date'; label: string; key: string };

    const listItems: ListItem[] = [];
    let lastDay = '';
    for (const msg of messages) {
        const day = getDateLabel(msg.timestamp);
        if (day !== lastDay) {
            listItems.push({ type: 'date', label: day, key: `d-${msg.timestamp}` });
            lastDay = day;
        }
        listItems.push({ type: 'msg', msg });
    }

    const renderItem = ({ item, index }: { item: ListItem; index: number }) => {
        if (item.type === 'date') {
            return <DateSeparator label={item.label} />;
        }
        const { msg } = item;
        // In an inverted list, the item at index+1 is chronologically earlier (or a date label).
        // We "group" this bubble if the NEXT item (index-1, i.e. item above in visual order)
        // is from the same sender — i.e. hide its avatar/name.
        const next = listItems[index - 1];
        const isGrouped =
            next?.type === 'msg' &&
            next.msg.is_outgoing === msg.is_outgoing &&
            next.msg.sender_name === msg.sender_name;

        return (
            <MessageBubble
                item={msg}
                contactName={senderName || 'Sender'}
                isGrouped={isGrouped}
                isPending={pendingIds.has(msg.id)}
            />
        );
    };

    const keyExtractor = (item: ListItem) =>
        item.type === 'date' ? item.key : item.msg.id;

    // ── Loading screen ─────────────────────────────────────────────────────────
    if (loading) {
        return (
            <View style={styles.loadingScreen}>
                <ActivityIndicator size="large" color="#4F46E5" />
                <Text style={styles.loadingText}>Loading chat…</Text>
            </View>
        );
    }

    // ── Main UI ────────────────────────────────────────────────────────────────
    return (
        <View style={styles.root}>
            {/*
             * KeyboardAvoidingView handles iOS.
             * On Android, softwareKeyboardLayoutMode="pan" in app.json handles it,
             * and we use a Keyboard listener to add bottom padding to the input bar.
             */}
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
            >
                {/* Message list */}
                {messages.length === 0 ? (
                    <View style={styles.emptyBox}>
                        <Text style={styles.emptyEmoji}>💬</Text>
                        <Text style={styles.emptyTitle}>No messages yet</Text>
                        <Text style={styles.emptySub}>Send a reply below to start the conversation.</Text>
                    </View>
                ) : (
                    <FlatList
                        ref={flatListRef}
                        data={listItems}
                        renderItem={renderItem}
                        keyExtractor={keyExtractor}
                        inverted
                        onEndReached={loadMore}
                        onEndReachedThreshold={0.4}
                        ListFooterComponent={
                            loadingMore
                                ? <ActivityIndicator style={{ padding: 16 }} color="#4F46E5" />
                                : null
                        }
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    />
                )}

                {/* Input bar — sits at bottom, pushed up by keyboard padding on Android */}
                <View style={[styles.inputBar, { paddingBottom: bottomPad > 0 ? 8 : (Platform.OS === 'ios' ? 24 : 12) }]}>
                    <TextInput
                        ref={inputRef}
                        style={styles.input}
                        value={inputText}
                        onChangeText={setInputText}
                        placeholder="Type a reply…"
                        placeholderTextColor="#9CA3AF"
                        multiline
                        maxLength={5000}
                        editable={!sending}
                        returnKeyType="default"
                        blurOnSubmit={false}
                    />
                    <TouchableOpacity
                        style={[
                            styles.sendBtn,
                            (!inputText.trim() || sending) && styles.sendBtnOff,
                        ]}
                        onPress={handleSend}
                        disabled={!inputText.trim() || sending}
                        activeOpacity={0.8}
                    >
                        {sending ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <Text style={styles.sendBtnTxt}>↑</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ACCENT = '#4F46E5';
const BG = '#F0F4FF';

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    flex: { flex: 1 },

    // Loading
    loadingScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    loadingText: { fontSize: 14, color: '#6B7280' },

    // Empty
    emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 8 },
    emptyEmoji: { fontSize: 52 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: '#374151' },
    emptySub: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },

    // List
    listContent: { paddingHorizontal: 12, paddingBottom: 8, paddingTop: 8 },

    // Date separator
    separator: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 10,
        paddingHorizontal: 8,
    },
    sepLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#CBD5E1' },
    sepLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#94A3B8',
        marginHorizontal: 10,
        letterSpacing: 0.3,
    },

    // Row
    msgRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginVertical: 1,
    },
    msgRowIn: { justifyContent: 'flex-start' },
    msgRowOut: { justifyContent: 'flex-end' },

    // Avatar
    avatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: '#E0E7FF',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 6,
        flexShrink: 0,
    },
    avatarHidden: { opacity: 0 },
    avatarText: { fontSize: 11, fontWeight: '700', color: ACCENT },

    // Bubble
    bubble: {
        maxWidth: '76%',
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 18,
    },
    bubbleIn: {
        backgroundColor: '#FFFFFF',
        borderBottomLeftRadius: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 1,
    },
    bubbleOut: {
        backgroundColor: ACCENT,
        borderBottomRightRadius: 4,
        shadowColor: ACCENT,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 3,
    },
    bubbleGroupedIn: { borderTopLeftRadius: 6 },
    bubbleGroupedOut: { borderTopRightRadius: 6 },

    senderLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: ACCENT,
        marginBottom: 3,
    },
    bodyText: { fontSize: 15, color: '#1F2937', lineHeight: 22 },
    bodyTextOut: { color: '#FFFFFF' },

    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginTop: 4,
        gap: 4,
    },
    timeText: { fontSize: 10, color: '#9CA3AF' },
    timeTextOut: { color: 'rgba(255,255,255,0.55)' },
    tickText: { fontSize: 10, color: 'rgba(255,255,255,0.65)' },

    // Input bar
    inputBar: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        paddingHorizontal: 12,
        paddingTop: 8,
        backgroundColor: '#FFFFFF',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#E2E8F0',
        gap: 8,
    },
    input: {
        flex: 1,
        minHeight: 42,
        maxHeight: 120,
        backgroundColor: '#F1F5F9',
        borderRadius: 21,
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 11 : 8,
        paddingBottom: Platform.OS === 'ios' ? 11 : 8,
        fontSize: 15,
        color: '#1F2937',
        lineHeight: 20,
    },
    sendBtn: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: ACCENT,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        shadowColor: ACCENT,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 5,
        elevation: 4,
    },
    sendBtnOff: { opacity: 0.35, shadowOpacity: 0 },
    sendBtnTxt: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: -1 },
});
