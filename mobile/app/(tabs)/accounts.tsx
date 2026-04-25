import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fetchAccounts } from '@/lib/api';
import type { Account } from '@/lib/types';

const STATUS_CONFIG: Record<string, { color: string; bg: string; dot: string; label: string }> = {
    active:      { color: '#065F46', bg: '#D1FAE5', dot: '#10B981', label: 'Active' },
    needs_login: { color: '#92400E', bg: '#FEF3C7', dot: '#F59E0B', label: 'Needs Login' },
    offline:     { color: '#374151', bg: '#F3F4F6', dot: '#9CA3AF', label: 'Offline' },
};

function getInitials(fb_name: string | null, nickname: string): string {
    const src = fb_name || nickname;
    const words = src.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
}

function AccountCard({ item }: { item: Account }) {
    const displayName = item.nickname || item.fb_name || 'Session';
    const showFbName = !!(item.fb_name && item.fb_name !== item.nickname);
    const status = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.offline;
    const initials = getInitials(item.nickname || item.fb_name || null, item.nickname);
    const shortId = item.id.length > 20 ? item.id.slice(0, 20) + '…' : item.id;

    return (
        <View style={styles.card}>
            <View style={styles.topRow}>
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                </View>
                <View style={styles.nameBlock}>
                    <Text style={styles.displayName} numberOfLines={1}>{displayName}</Text>
                    {showFbName && (
                        <Text style={styles.nickname} numberOfLines={1}>FB: {item.fb_name}</Text>
                    )}
                </View>
                <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                    <View style={[styles.statusDot, { backgroundColor: status.dot }]} />
                    <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
                </View>
            </View>

            <View style={styles.details}>
                <View style={styles.detailRow}>
                    <Text style={styles.detailKey}>FB User ID</Text>
                    <Text style={[styles.detailVal, styles.mono]} numberOfLines={1}>
                        {item.fb_user_id ?? 'Not scraped yet'}
                    </Text>
                </View>
                <View style={[styles.detailRow, { borderBottomWidth: 0, marginBottom: 4 }]}>
                    <Text style={styles.detailKey}>Account ID</Text>
                    <Text style={[styles.detailVal, styles.mono]} numberOfLines={1}>{shortId}</Text>
                </View>
            </View>
        </View>
    );
}

export default function AccountsScreen() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setError(null);
            setAccounts(await fetchAccounts());
        } catch (err: any) {
            setError(err.message || 'Failed to load');
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
    }, [load]);

    if (error) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity onPress={load} style={styles.retryBtn}>
                    <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <FlatList
            data={accounts}
            renderItem={({ item }) => <AccountCard item={item} />}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            contentContainerStyle={[styles.list, accounts.length === 0 && styles.emptyContainer]}
            ListEmptyComponent={
                <View style={styles.center}>
                    <Text style={styles.emptyTitle}>No accounts configured</Text>
                    <Text style={styles.emptyHint}>Add accounts in the desktop app</Text>
                </View>
            }
        />
    );
}

const styles = StyleSheet.create({
    list: { padding: 16, gap: 12 },
    emptyContainer: { flex: 1 },
    card: {
        backgroundColor: '#fff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.07,
        shadowRadius: 4,
        elevation: 2,
        overflow: 'hidden',
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 14,
    },
    avatar: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: '#4F46E5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    nameBlock: { flex: 1 },
    displayName: { fontSize: 17, fontWeight: '700', color: '#111827' },
    nickname: { fontSize: 13, color: '#6B7280', marginTop: 2 },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
    },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusLabel: { fontSize: 12, fontWeight: '600' },
    details: {
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        marginHorizontal: 16,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        gap: 8,
    },
    detailKey: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', minWidth: 85 },
    detailVal: { flex: 1, fontSize: 13, color: '#374151', textAlign: 'right' },
    mono: { fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'monospace' }) },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: '#374151' },
    emptyHint: { fontSize: 14, color: '#9CA3AF', marginTop: 6 },
    errorText: { fontSize: 15, color: '#EF4444', textAlign: 'center', marginBottom: 16 },
    retryBtn: { backgroundColor: '#4F46E5', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
    retryText: { color: '#fff', fontWeight: '600' },
});
