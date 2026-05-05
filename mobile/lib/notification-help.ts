import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * Some Android OEMs ship aggressive battery savers that kill background
 * services and silently drop FCM messages even when notification permission
 * is granted. The user has to manually whitelist the app in two places:
 *
 *   1. Battery optimization → Don't optimize / Allow background activity
 *   2. Autostart manager (Xiaomi/Oppo/Vivo/Huawei/Realme) → Enable
 *
 * Stock Android (Pixel/Samsung One UI 6+) doesn't need this.
 */

export type OemProfile = {
    manufacturer: string;
    aggressive: boolean;
    label: string;
    steps: string[];
};

const OEM_GUIDES: Record<string, { label: string; steps: string[] }> = {
    xiaomi: {
        label: 'Xiaomi / Redmi / POCO (MIUI)',
        steps: [
            'Tap Open App Settings below',
            'Battery saver → No restrictions',
            'Back → Autostart → Enable',
            'Back → Other permissions → Display pop-up windows while running in background → Allow',
        ],
    },
    redmi: {
        label: 'Xiaomi / Redmi / POCO (MIUI)',
        steps: [
            'Tap Open App Settings below',
            'Battery saver → No restrictions',
            'Back → Autostart → Enable',
            'Back → Other permissions → Display pop-up windows while running in background → Allow',
        ],
    },
    poco: {
        label: 'Xiaomi / Redmi / POCO (MIUI)',
        steps: [
            'Tap Open App Settings below',
            'Battery saver → No restrictions',
            'Back → Autostart → Enable',
            'Back → Other permissions → Display pop-up windows while running in background → Allow',
        ],
    },
    oppo: {
        label: 'OPPO (ColorOS)',
        steps: [
            'Tap Open App Settings below',
            'Battery usage → Allow background activity',
            'Back → Manage auto-launch / Startup manager → Enable',
        ],
    },
    realme: {
        label: 'Realme (realme UI)',
        steps: [
            'Tap Open App Settings below',
            'Battery usage → Allow background activity',
            'Back → Auto-launch → Enable',
        ],
    },
    oneplus: {
        label: 'OnePlus (OxygenOS)',
        steps: [
            'Tap Open App Settings below',
            'Battery → Don\'t optimize',
            'Back → Manage auto-launch (or Battery → Background optimization)',
        ],
    },
    vivo: {
        label: 'vivo (Funtouch / OriginOS)',
        steps: [
            'Tap Open App Settings below',
            'Battery → High background power consumption → Allow',
            'Back → Auto-start → Enable',
        ],
    },
    iqoo: {
        label: 'iQOO (Funtouch)',
        steps: [
            'Tap Open App Settings below',
            'Battery → High background power consumption → Allow',
            'Back → Auto-start → Enable',
        ],
    },
    huawei: {
        label: 'Huawei (EMUI / HarmonyOS)',
        steps: [
            'Tap Open App Settings below',
            'Battery → App launch → turn OFF Manage automatically',
            'Then enable: Auto-launch + Secondary launch + Run in background',
        ],
    },
    honor: {
        label: 'Honor (MagicOS / EMUI)',
        steps: [
            'Tap Open App Settings below',
            'Battery → App launch → turn OFF Manage automatically',
            'Then enable: Auto-launch + Secondary launch + Run in background',
        ],
    },
    samsung: {
        label: 'Samsung (One UI)',
        // One UI 6 generally fine; older or aggressive Adaptive Battery can still kill.
        steps: [
            'Tap Open App Settings below',
            'Battery → Allow background activity',
            'If issues persist: Battery → Background usage limits → remove app from "Sleeping apps"',
        ],
    },
    google: {
        label: 'Google Pixel (stock Android)',
        steps: [
            'No extra setup needed on stock Android.',
            'If notifications still don\'t arrive, tap Open App Settings and verify Notifications is enabled.',
        ],
    },
};

const AGGRESSIVE_BRANDS = new Set([
    'xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'oneplus', 'vivo', 'iqoo', 'huawei', 'honor',
]);

export function getOemProfile(): OemProfile | null {
    if (Platform.OS !== 'android') return null;

    const raw = (Device.manufacturer || '').trim().toLowerCase();
    const brand = (Device.brand || '').trim().toLowerCase();
    const key = OEM_GUIDES[raw] ? raw : OEM_GUIDES[brand] ? brand : null;

    if (!key) {
        // Unknown OEM — show generic guidance
        return {
            manufacturer: Device.manufacturer || 'Unknown',
            aggressive: false,
            label: Device.manufacturer || 'Android device',
            steps: [
                'Tap Open App Settings below',
                'Verify Notifications is enabled',
                'Verify Battery → Allow background activity (or "Don\'t optimize")',
            ],
        };
    }

    const guide = OEM_GUIDES[key];
    return {
        manufacturer: Device.manufacturer || key,
        aggressive: AGGRESSIVE_BRANDS.has(key),
        label: guide.label,
        steps: guide.steps,
    };
}
