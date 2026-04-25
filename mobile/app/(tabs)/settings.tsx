import { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Alert,
} from 'react-native';
import { getServerUrl, setServerUrl, getApiToken, setApiToken, getPushToken, clearAll } from '@/lib/storage';
import { testConnection } from '@/lib/api';
import { setupPushNotifications } from '@/lib/notifications';

export default function SettingsScreen() {
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [pushToken, setPushTokenState] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

    useEffect(() => {
        (async () => {
            setUrl(await getServerUrl());
            setToken(await getApiToken());
            setPushTokenState(await getPushToken());
        })();
    }, []);

    const save = async () => {
        await setServerUrl(url);
        await setApiToken(token);
        setStatus('idle');
        Alert.alert('Saved', 'Settings saved');
    };

    const test = async () => {
        setStatus('testing');
        const ok = await testConnection();
        setStatus(ok ? 'ok' : 'fail');
    };

    const registerPush = async () => {
        const t = await setupPushNotifications();
        if (t) {
            setPushTokenState(t);
            Alert.alert('Push Token Registered', t);
        } else {
            Alert.alert(
                'Push Not Available',
                'Could not get push token. On Android, remote push requires a development build (not Expo Go).'
            );
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

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
                style={styles.input}
                value={url}
                onChangeText={(v) => { setUrl(v); setStatus('idle'); }}
                placeholder="http://192.168.1.100:3847"
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
                placeholder="Bearer token from desktop app"
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
            {pushToken ? (
                <Text style={styles.tokenText} selectable>
                    {pushToken}
                </Text>
            ) : (
                <Text style={styles.tokenPlaceholder}>Not registered</Text>
            )}
            <TouchableOpacity style={styles.secondaryBtn} onPress={registerPush}>
                <Text style={styles.secondaryBtnText}>
                    {pushToken ? 'Re-register Push Token' : 'Register Push Token'}
                </Text>
            </TouchableOpacity>

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
    sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
    tokenText: { fontSize: 12, color: '#6B7280', fontFamily: 'monospace', marginBottom: 12 },
    tokenPlaceholder: { fontSize: 14, color: '#9CA3AF', marginBottom: 12 },
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
});
