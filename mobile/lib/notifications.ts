import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerDeviceToken } from './api';
import { setPushToken } from './storage';

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

    const tokenObj = await Notifications.getExpoPushTokenAsync({ projectId });

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
