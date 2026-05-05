import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerDeviceToken } from './api';
import { getPushToken, setPushToken } from './storage';

let handlerConfigured = false;

function isAndroidExpoGo(): boolean {
    return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

async function getNotificationsModule() {
    return await import('expo-notifications');
}

async function ensureNotificationHandler(): Promise<void> {
    if (handlerConfigured || isAndroidExpoGo()) return;
    const Notifications = await getNotificationsModule();
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
        }),
    });
    handlerConfigured = true;
}

async function ensureAndroidNotificationChannel(): Promise<void> {
    if (Platform.OS !== 'android' || isAndroidExpoGo()) return;
    const Notifications = await getNotificationsModule();
    await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4F46E5',
    });
}

export async function setupPushNotifications(): Promise<string | null> {
    if (isAndroidExpoGo()) {
        console.log('[Push] Android remote push is not supported in Expo Go. Use a development build.');
        return null;
    }

    if (!Device.isDevice) {
        console.log('[Push] Not a physical device — skipping push setup');
        return null;
    }

    await ensureNotificationHandler();
    const Notifications = await getNotificationsModule();
    await ensureAndroidNotificationChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('[Push] Permission not granted');
        return null;
    }

    const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

    if (!projectId) {
        console.log('[Push] No EAS projectId configured — skipping Expo push token');
        return null;
    }

    let tokenObj;
    try {
        tokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
    } catch (err) {
        const msg = String((err as { message?: string } | undefined)?.message || err || '');
        if (Platform.OS === 'android' && msg.includes('Default FirebaseApp is not initialized')) {
            console.error(
                '[Push] Firebase is not initialized. Add google-services.json in mobile/ or set GOOGLE_SERVICES_JSON, then rebuild Android app.'
            );
            return null;
        }
        throw err;
    }

    const token = tokenObj.data;
    console.log('[Push] Expo push token:', token);

    // Store locally and register with backend
    await setPushToken(token);
    try {
        await registerDeviceToken(token, Platform.OS === 'android' ? 'android' : 'ios');
        console.log('[Push] Token registered with backend');
    } catch (err) {
        console.warn('[Push] Failed to register token with backend:', err);
    }

    return token;
}

export async function syncPushTokenWithBackend(): Promise<boolean> {
    if (isAndroidExpoGo() || !Device.isDevice) {
        return false;
    }

    // Re-mint the token from the OS — on Android it can rotate after reinstall,
    // app-data clear, OS update, or Google Play Services refresh. Sending the
    // cached token in those cases = silent delivery failure.
    const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;
    if (!projectId) return false;

    let freshToken: string | null = null;
    try {
        const Notifications = await getNotificationsModule();
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') return false;
        const tokenObj = await Notifications.getExpoPushTokenAsync({ projectId });
        freshToken = tokenObj.data;
    } catch (err) {
        // Fall back to cached token — better stale than nothing.
        const cached = await getPushToken();
        if (!cached) return false;
        freshToken = cached;
    }

    if (!freshToken) return false;

    const cached = await getPushToken();
    if (cached !== freshToken) {
        console.log('[Push] Token rotated — updating cache + backend');
        await setPushToken(freshToken);
    }

    try {
        await registerDeviceToken(freshToken, Platform.OS === 'android' ? 'android' : 'ios');
        return true;
    } catch (err) {
        console.warn('[Push] Failed to sync token with backend:', err);
        return false;
    }
}

export function addNotificationResponseListener(
    handler: (response: any) => void
) {
    if (isAndroidExpoGo()) {
        return { remove: () => {} };
    }

    // Keep sync signature while avoiding top-level expo-notifications import.
    let subscription: { remove: () => void } | null = null;
    getNotificationsModule()
        .then((Notifications) => {
            subscription = Notifications.addNotificationResponseReceivedListener(handler);
        })
        .catch((e) => {
            console.warn('[Push] Listener setup failed:', e);
        });

    return {
        remove: () => {
            if (subscription) subscription.remove();
        },
    };
}
