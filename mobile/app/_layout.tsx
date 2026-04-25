import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setupPushNotifications, addNotificationResponseListener } from '@/lib/notifications';
import { setCachedSenderName, getServerUrl, setServerUrl, getApiToken, setApiToken } from '@/lib/storage';
import { DEFAULT_SERVER_URL, DEFAULT_API_TOKEN } from '@/lib/client-config';

// Auto-configure on first launch if defaults are provided and nothing is saved yet
async function applyDefaultConfigIfNeeded() {
    const hasPlaceholderUrl = DEFAULT_SERVER_URL.includes('YOUR-NGROK-DOMAIN');
    const hasPlaceholderToken = DEFAULT_API_TOKEN.includes('YOUR-API-TOKEN');
    if (hasPlaceholderUrl || hasPlaceholderToken) return; // not yet configured by developer

    const existing = await getServerUrl();
    if (!existing) {
        await setServerUrl(DEFAULT_SERVER_URL);
        await setApiToken(DEFAULT_API_TOKEN);
        console.log('[Config] Auto-applied default server URL and token');
    }
}

export default function RootLayout() {
    const router = useRouter();

    useEffect(() => {
        applyDefaultConfigIfNeeded().catch(() => {});

        setupPushNotifications().catch((e) =>
            console.warn('[Push] Setup failed:', e)
        );

        const subscription = addNotificationResponseListener((response) => {
            const data = response.notification.request.content.data;
            if (data?.conversationId && data?.accountId) {
                // Cache sender name so inbox shows it even without opening conversation
                if (data.senderName) {
                    setCachedSenderName(data.conversationId, data.senderName).catch(() => {});
                }
                router.push({
                    pathname: '/conversation/[id]',
                    params: {
                        id: data.conversationId,
                        accountId: data.accountId,
                        senderName: data.senderName || '',
                    },
                });
            }
        });

        return () => subscription.remove();
    }, []);

    return (
        <>
            <StatusBar style="auto" />
            <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                    name="conversation/[id]"
                    options={{
                        title: 'Conversation',
                        headerBackTitle: 'Back',
                    }}
                />
            </Stack>
        </>
    );
}