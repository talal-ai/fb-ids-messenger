import { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Alert,
    Linking,
    Platform,
    AppState,
} from 'react-native';
import { getServerUrl, setServerUrl, getApiToken, setApiToken, getPushToken, clearAll } from '@/lib/storage';
import { testConnection } from '@/lib/api';
import { setupPushNotifications, syncPushTokenWithBackend } from '@/lib/notifications';
import { getOemProfile, OemProfile } from '@/lib/notification-help';

type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';

export default function SettingsScreen() {
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [pushToken, setPushTokenState] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
    const [permission, setPermission] = useState<PermissionState>('unknown');
    const [oem] = useState<OemProfile | null>(() => getOemProfile());

    const refreshPermission = useCallback(async () => {
        if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
        try {
            const Notifications = await import('expo-notifications');
            const { status } = await Notifications.getPermissionsAsync();
            setPermission(
                status === 'granted' ? 'granted'
                : status === 'denied' ? 'denied'
                : 'undetermined'
            );
        } catch {
            setPermission('unknown');
        }
    }, []);

    useEffect(() => {
        (async () => {
            setUrl(await getServerUrl());
            setToken(await getApiToken());
            setPushTokenState(await getPushToken());
            await refreshPermission();
        })();

        // Refresh permission state when user comes back from system Settings.
        const sub = AppState.addEventListener('change', (next) => {
            if (next === 'active') refreshPermission();
        });
        return () => sub.remove();
    }, [refreshPermission]);

    const save = async () => {
        await setServerUrl(url);
        await setApiToken(token);
        const synced = await syncPushTokenWithBackend();
        if (!synced) {
            const maybeToken = await setupPushNotifications();
            if (maybeToken) setPushTokenState(maybeToken);
        }
        await refreshPermission();
        setStatus('idle');
        Alert.alert('Saved', 'Settings saved. Push registration was refreshed.');
    };

    const test = async () => {
        setStatus('testing');
        const ok = await testConnection();
        setStatus(ok ? 'ok' : 'fail');
    };

    const registerPush = async () => {
        const t = await setupPushNotifications();
        await refreshPermission();
        if (t) {
            setPushTokenState(t);
            Alert.alert('Push Token Registered', t);
        } else {
            Alert.alert(
                'Push Not Available',
                'Could not get push token. On Android, remote push requires a development or production build (not Expo Go).'
            );
        }
    };

    const openAppSettings = async () => {
        try {
            await Linking.openSettings();
        } catch {
            Alert.alert('Could not open settings', 'Please open Android Settings → Apps → FB Manager Mobile manually.');
        }
    };

    const reset = () => {
        Alert.alert('Clear Settings', 'This will remove all stored settings.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Clear',
                style: 'destructive',
                onPress: async () => {
                    await clearAll();
                    setUrl('');
                    setToken('');
                    setPushTokenState(null);
                    setStatus('idle');
                },
            },
        ]);
    };

    const permissionPill = () => {
        const map: Record<PermissionState, { label: string; bg: string; fg: string }> = {
            granted:      { label: '✓ Granted',        bg: '#F0FDF4', fg: '#065F46' },
            denied:       { label: '✗ Denied',         bg: '#FEF2F2', fg: '#B91C1C' },
            undetermined: { label: '… Not asked yet',  bg: '#FFFBEB', fg: '#92400E' },
            unknown:      { label: '?',                bg: '#F3F4F6', fg: '#6B7280' },
        };
        const p = map[permission];
        return (
            <View style={[styles.pill, { backgroundColor: p.bg }]}>
                <Text style={[styles.pillText, { color: p.fg }]}>{p.label}</Text>
            </View>
        );
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
                style={styles.input}
                value={url}
                onChangeText={(v) => { setUrl(v); setStatus('idle'); }}
                placeholder="https://multi-messenger.gadgetronics.pk"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
            />

            <Text style={styles.label}>API Token</Text>
            <TextInput
                style={styles.input}
                value={token}
                onChangeText={(v) => { setToken(v); setStatus('idle'); }}
                placeholder="Paste token from Desktop → API Settings"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
            />

            <TouchableOpacity style={styles.primaryBtn} onPress={save}>
                <Text style={styles.primaryBtnText}>Save</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[
                    styles.secondaryBtn,
                    { marginTop: 12 },
                    status === 'ok' && styles.statusOkBtn,
                    status === 'fail' && styles.statusFailBtn,
                ]}
                onPress={test}
                disabled={status === 'testing'}
            >
                <Text style={[
                    styles.secondaryBtnText,
                    status === 'ok' && styles.statusOkText,
                    status === 'fail' && styles.statusFailText,
                ]}>
                    {status === 'testing'
                        ? 'Testing…'
                        : status === 'ok'
                        ? '✓ Connected'
                        : status === 'fail'
                        ? '✗ Connection Failed — Retry'
                        : 'Test Connection'}
                </Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <Text style={styles.sectionTitle}>Push Notifications</Text>

            <View style={styles.statusRow}>
                <Text style={styles.statusKey}>Permission</Text>
                {permissionPill()}
            </View>
            <View style={styles.statusRow}>
                <Text style={styles.statusKey}>Token</Text>
                <View style={[styles.pill, { backgroundColor: pushToken ? '#F0FDF4' : '#FEF2F2' }]}>
                    <Text style={[styles.pillText, { color: pushToken ? '#065F46' : '#B91C1C' }]}>
                        {pushToken ? '✓ Registered' : '✗ Not registered'}
                    </Text>
                </View>
            </View>

            {pushToken ? (
                <Text style={styles.tokenText} selectable>{pushToken}</Text>
            ) : null}

            <TouchableOpacity style={styles.secondaryBtn} onPress={registerPush}>
                <Text style={styles.secondaryBtnText}>
                    {pushToken ? 'Re-register Push Token' : 'Register Push Token'}
                </Text>
            </TouchableOpacity>

            {Platform.OS === 'android' && oem ? (
                <View style={styles.oemCard}>
                    <Text style={styles.oemTitle}>
                        {oem.aggressive ? '⚠️ ' : ''}Notification reliability — {oem.label}
                    </Text>
                    {oem.aggressive ? (
                        <Text style={styles.oemBlurb}>
                            Your phone brand kills background apps aggressively, which can drop push
                            notifications even when permission is granted. Follow these steps once:
                        </Text>
                    ) : (
                        <Text style={styles.oemBlurb}>
                            If notifications don't arrive reliably, follow these steps:
                        </Text>
                    )}

                    {oem.steps.map((s, i) => (
                        <View key={i} style={styles.stepRow}>
                            <Text style={styles.stepNum}>{i + 1}.</Text>
                            <Text style={styles.stepText}>{s}</Text>
                        </View>
                    ))}

                    <TouchableOpacity style={styles.oemBtn} onPress={openAppSettings}>
                        <Text style={styles.oemBtnText}>Open App Settings</Text>
                    </TouchableOpacity>

                    <Text style={styles.oemFootnote}>
                        After changing settings, return here — the permission status above will refresh
                        automatically.
                    </Text>
                </View>
            ) : null}

            <View style={styles.divider} />

            <TouchableOpacity style={styles.dangerBtn} onPress={reset}>
                <Text style={styles.dangerBtnText}>Clear All Settings</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },
    content: { padding: 20 },
    label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6, marginTop: 16 },
    input: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 8,
        padding: 12,
        fontSize: 15,
    },
    primaryBtn: {
        backgroundColor: '#4F46E5',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 20,
    },
    primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    secondaryBtn: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
    },
    secondaryBtnText: { color: '#374151', fontSize: 15, fontWeight: '500' },
    divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 24 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
    statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    statusKey: { fontSize: 14, color: '#374151', fontWeight: '500' },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    pillText: { fontSize: 12, fontWeight: '600' },
    tokenText: { fontSize: 11, color: '#6B7280', fontFamily: 'monospace', marginVertical: 12 },
    dangerBtn: {
        borderWidth: 1,
        borderColor: '#EF4444',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
    },
    dangerBtnText: { color: '#EF4444', fontSize: 15, fontWeight: '500' },
    statusOkBtn: { borderColor: '#10B981', backgroundColor: '#F0FDF4' },
    statusOkText: { color: '#065F46' },
    statusFailBtn: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
    statusFailText: { color: '#EF4444' },

    oemCard: {
        marginTop: 20,
        backgroundColor: '#FFFBEB',
        borderWidth: 1,
        borderColor: '#FCD34D',
        borderRadius: 10,
        padding: 14,
    },
    oemTitle: { fontSize: 14, fontWeight: '700', color: '#92400E', marginBottom: 6 },
    oemBlurb: { fontSize: 13, color: '#78350F', marginBottom: 10, lineHeight: 18 },
    stepRow: { flexDirection: 'row', marginBottom: 6 },
    stepNum: { fontSize: 13, fontWeight: '700', color: '#92400E', marginRight: 8, minWidth: 18 },
    stepText: { fontSize: 13, color: '#78350F', flex: 1, lineHeight: 18 },
    oemBtn: {
        marginTop: 12,
        backgroundColor: '#92400E',
        borderRadius: 8,
        paddingVertical: 10,
        alignItems: 'center',
    },
    oemBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    oemFootnote: { fontSize: 11, color: '#92400E', marginTop: 10, fontStyle: 'italic', lineHeight: 16 },
});
