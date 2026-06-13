import { useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    FlatList,
    Pressable,
    RefreshControl,
    ActivityIndicator,
    StyleSheet,
    TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { fetchConversations } from '@/lib/api';
import { getBulkCachedSenderNames } from '@/lib/storage';
import type { Conversation } from '@/lib/types';

function isMissingSenderName(name: string | null): boolean {
    if (!name) return true;
    const normalized = name.trim().toLowerCase();
    return normalized === '' || normalized === 'unknown' || normalized === 'unknown sender';
}

function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return `${Math.floor(days / 7)}w`;
}

function getInitials(name: string | null): string {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

// Deterministic per-person color so each contact keeps the same avatar hue.
const PALETTE = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#3B82F6', '#F43F5E'];
function colorFor(name: string | null): string {
    const s = name || '?';
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

function ConvRow({ item, onPress }: { item: Conversation; onPress: () => void }) {
    const unread = item.unread_count > 0;
    const senderName = item.participant_name || 'Unknown Sender';
    const accountLabel =
        item.account_label && item.account_label.trim()
            ? item.account_label
            : item.account_fb_user_id
            ? `FB: ${item.account_fb_user_id.slice(-9)}`
            : 'Unknown Account';
    const initials = getInitials(item.participant_name);
    const hue = colorFor(item.participant_name);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                unread && styles.rowUnread,
                pressed && styles.rowPressed,
            ]}
        >
            {/* Unread accent bar */}
            <View style={[styles.accent, unread && { backgroundColor: hue }]} />

            {/* Avatar */}
            <View style={[styles.avatar, { backgroundColor: hue + '22' }]}>
                <Text style={[styles.avatarText, { color: hue }]}>{initials}</Text>
                {unread && <View style={[styles.onlineDot, { backgroundColor: hue }]} />}
            </View>

            {/* Text block */}
            <View style={styles.textBlock}>
                <View style={styles.nameRow}>
                    <Text style={[styles.sender, unread && styles.bold]} numberOfLines={1}>
                        {senderName}
                    </Text>
                    <Text style={[styles.time, unread && { color: hue, fontWeight: '700' }]}>
                        {timeAgo(item.last_message_at)}
                    </Text>
                </View>

                <View style={styles.labelRow}>
                    <Ionicons name="at-outline" size={11} color="#9CA3AF" />
                    <Text style={styles.labelPillText} numberOfLines={1}>{accountLabel}</Text>
                </View>

                <View style={styles.previewRow}>
                    <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                        {item.last_message || '(no messages)'}
                    </Text>
                    {unread && (
                        <View style={[styles.badge, { backgroundColor: hue }]}>
                            <Text style={styles.badgeText}>
                                {item.unread_count > 99 ? '99+' : item.unread_count}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </Pressable>
    );
}

function SkeletonRow() {
    return (
        <View style={styles.row}>
            <View style={styles.accent} />
            <View style={[styles.avatar, styles.skelBlock]} />
            <View style={styles.textBlock}>
                <View style={[styles.skelBlock, { width: '45%', height: 14, borderRadius: 7 }]} />
                <View style={[styles.skelBlock, { width: '30%', height: 10, borderRadius: 5, marginTop: 8 }]} />
                <View style={[styles.skelBlock, { width: '70%', height: 12, borderRadius: 6, marginTop: 8 }]} />
            </View>
        </View>
    );
}

export default function InboxScreen() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const router = useRouter();

    const load = useCallback(async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            setError(null);
            const raw = await fetchConversations();
            const needsName = raw.filter((c) => isMissingSenderName(c.participant_name));
            if (needsName.length > 0) {
                const cached = await getBulkCachedSenderNames(needsName.map((c) => c.id));
                setConversations(
                    raw.map((c) => ({
                        ...c,
                        participant_name: isMissingSenderName(c.participant_name)
                            ? cached[c.id] || null
                            : c.participant_name,
                    }))
                );
            } else {
                setConversations(raw);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load(true);
            const interval = setInterval(() => load(false), 10000);
            return () => clearInterval(interval);
        }, [load])
    );

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await load(false);
        setRefreshing(false);
    }, [load]);

    const totalUnread = useMemo(
        () => conversations.reduce((n, c) => n + (c.unread_count > 0 ? 1 : 0), 0),
        [conversations]
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return conversations;
        return conversations.filter(
            (c) =>
                (c.participant_name || '').toLowerCase().includes(q) ||
                (c.last_message || '').toLowerCase().includes(q) ||
                (c.account_label || '').toLowerCase().includes(q)
        );
    }, [conversations, query]);

    const SearchHeader = (
        <View style={styles.searchWrap}>
            <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color="#9CA3AF" />
                <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search conversations"
                    placeholderTextColor="#9CA3AF"
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                />
                {query.length > 0 && (
                    <Pressable onPress={() => setQuery('')} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color="#CBD5E1" />
                    </Pressable>
                )}
            </View>
            {totalUnread > 0 && (
                <Text style={styles.unreadSummary}>
                    {totalUnread} unread {totalUnread === 1 ? 'chat' : 'chats'}
                </Text>
            )}
        </View>
    );

    if (loading) {
        return (
            <View style={styles.screen}>
                {SearchHeader}
                {Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)}
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.screen}>
                {SearchHeader}
                <View style={styles.center}>
                    <Ionicons name="cloud-offline-outline" size={48} color="#CBD5E1" />
                    <Text style={styles.errorText}>{error}</Text>
                    <Pressable onPress={() => load(true)} style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}>
                        <Ionicons name="refresh" size={16} color="#fff" />
                        <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <FlatList
                data={filtered}
                ListHeaderComponent={SearchHeader}
                renderItem={({ item }) => (
                    <ConvRow
                        item={item}
                        onPress={() =>
                            router.push({
                                pathname: '/conversation/[id]',
                                params: {
                                    id: item.id,
                                    accountId: item.account_id,
                                    senderName: item.participant_name || `Thread ${item.id.slice(0, 10)}`,
                                    accountLabel: item.account_label,
                                },
                            })
                        }
                    />
                )}
                keyExtractor={(item) => item.id}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4F46E5" colors={['#4F46E5']} />
                }
                contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
                ListEmptyComponent={
                    <View style={styles.center}>
                        <Ionicons name={query ? 'search' : 'chatbubbles-outline'} size={52} color="#CBD5E1" />
                        <Text style={styles.emptyTitle}>{query ? 'No matches' : 'No conversations yet'}</Text>
                        <Text style={styles.emptySub}>
                            {query ? 'Try a different search.' : 'New messages will appear here.'}
                        </Text>
                    </View>
                }
                keyboardShouldPersistTaps="handled"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#F8FAFC' },

    // Search header
    searchWrap: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, backgroundColor: '#F8FAFC' },
    searchBox: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 14,
        paddingHorizontal: 14,
        height: 44,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#E2E8F0',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 3,
        elevation: 1,
    },
    searchInput: { flex: 1, fontSize: 15, color: '#1F2937' },
    unreadSummary: { fontSize: 12, color: '#6366F1', fontWeight: '600', marginTop: 8, marginLeft: 4 },

    // Row
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 16,
        paddingLeft: 6,
        paddingVertical: 12,
        marginHorizontal: 10,
        marginVertical: 3,
        borderRadius: 16,
        backgroundColor: '#fff',
        gap: 10,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 1,
    },
    rowUnread: { backgroundColor: '#FFFFFF' },
    rowPressed: { backgroundColor: '#F1F5F9', transform: [{ scale: 0.985 }] },
    accent: { width: 3.5, alignSelf: 'stretch', borderRadius: 2, backgroundColor: 'transparent', marginVertical: 4 },

    avatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#E0E7FF',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    avatarText: { fontSize: 16, fontWeight: '800', color: '#4F46E5' },
    onlineDot: {
        position: 'absolute',
        right: 1,
        top: 1,
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#fff',
    },

    textBlock: { flex: 1 },
    nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sender: { fontSize: 15.5, color: '#0F172A', flex: 1, marginRight: 8, fontWeight: '600' },
    bold: { fontWeight: '800' },
    time: { fontSize: 12, color: '#9CA3AF', flexShrink: 0 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 3 },
    labelPillText: { fontSize: 11.5, fontWeight: '600', color: '#94A3B8', flexShrink: 1 },
    previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, gap: 8 },
    preview: { fontSize: 13.5, color: '#94A3B8', flex: 1 },
    previewUnread: { color: '#475569', fontWeight: '500' },
    badge: {
        backgroundColor: '#4F46E5',
        borderRadius: 11,
        minWidth: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 6,
        flexShrink: 0,
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

    // States
    skelBlock: { backgroundColor: '#E9EEF5' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
    emptyContainer: { flexGrow: 1 },
    emptyTitle: { fontSize: 17, color: '#475569', fontWeight: '700', marginTop: 4 },
    emptySub: { fontSize: 14, color: '#94A3B8', textAlign: 'center' },
    errorText: { fontSize: 15, color: '#EF4444', textAlign: 'center', marginTop: 4 },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#4F46E5',
        paddingHorizontal: 22,
        paddingVertical: 11,
        borderRadius: 12,
        marginTop: 6,
    },
    retryText: { color: '#fff', fontWeight: '700' },
});
