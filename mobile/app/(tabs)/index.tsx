import { useState, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
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
    return `${Math.floor(hours / 24)}d`;
}

function getInitials(name: string | null): string {
    if (!name) return '?';
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
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

    return (
        <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
            {/* Avatar */}
            <View style={[styles.avatar, unread && styles.avatarUnread]}>
                <Text style={[styles.avatarText, unread && styles.avatarTextUnread]}>{initials}</Text>
            </View>

            {/* Text block */}
            <View style={styles.textBlock}>
                <View style={styles.nameRow}>
                    <Text style={[styles.sender, unread && styles.bold]} numberOfLines={1}>
                        {senderName}
                    </Text>
                    <Text style={styles.time}>{timeAgo(item.last_message_at)}</Text>
                </View>
                {/* Account label pill */}
                <View style={styles.labelRow}>
                    <View style={styles.labelPill}>
                        <Text style={styles.labelPillText}>Received via {accountLabel}</Text>
                    </View>
                </View>
                <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
                    {item.last_message || '(no messages)'}
                </Text>
            </View>

            {/* Unread badge */}
            {unread && (
                <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                        {item.unread_count > 99 ? '99+' : item.unread_count}
                    </Text>
                </View>
            )}
        </TouchableOpacity>
    );
}

export default function InboxScreen() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const router = useRouter();

    const load = useCallback(async (showSpinner = false) => {
        if (showSpinner) setLoading(true);
        try {
            setError(null);
            const raw = await fetchConversations();
            // For conversations where the backend hasn't resolved participant_name yet,
            // fill in from local cache (populated when conversations are opened or via push notifications)
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

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#4F46E5" />
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity onPress={() => load(true)} style={styles.retryBtn}>
                    <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <FlatList
            data={conversations}
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
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={conversations.length === 0 ? styles.emptyContainer : undefined}
            ListEmptyComponent={
                <View style={styles.center}>
                    <Text style={styles.emptyText}>No conversations yet</Text>
                </View>
            }
        />
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E7EB',
        backgroundColor: '#fff',
        gap: 12,
    },
    avatar: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: '#E0E7FF',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    avatarUnread: { backgroundColor: '#4F46E5' },
    avatarText: { fontSize: 16, fontWeight: '700', color: '#4F46E5' },
    avatarTextUnread: { color: '#fff' },
    textBlock: { flex: 1 },
    nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sender: { fontSize: 15, color: '#111827', flex: 1, marginRight: 8 },
    bold: { fontWeight: '700' },
    time: { fontSize: 12, color: '#9CA3AF', flexShrink: 0 },
    labelRow: { flexDirection: 'row', marginTop: 3 },
    labelPill: {
        backgroundColor: '#EEF2FF',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    labelPillText: { fontSize: 11, fontWeight: '600', color: '#4F46E5' },
    preview: { fontSize: 13, color: '#9CA3AF', marginTop: 3 },
    previewUnread: { color: '#374151' },
    badge: {
        backgroundColor: '#4F46E5',
        borderRadius: 12,
        minWidth: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 5,
        flexShrink: 0,
    },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
    emptyContainer: { flex: 1 },
    emptyText: { fontSize: 16, color: '#9CA3AF' },
    errorText: { fontSize: 15, color: '#EF4444', textAlign: 'center', marginBottom: 16 },
    retryBtn: { backgroundColor: '#4F46E5', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
    retryText: { color: '#fff', fontWeight: '600' },
});
