#!/usr/bin/env bash
# One-shot: install the EAS-built APK on a connected Android device, then tail
# the push-notification log lines so you can immediately verify token registration.
#
# Usage: ./scripts/install-apk.sh [path/to/file.apk]
# Default APK: ./fbmgr-preview.apk

set -e

# shellcheck disable=SC1091
source "$(dirname "$0")/android-env.sh"

APK_PATH="${1:-./fbmgr-preview.apk}"
APP_PKG="com.fbmanager.mobile"

if [ ! -f "$APK_PATH" ]; then
    echo "[install-apk] ✗ APK not found: $APK_PATH"
    echo "  Download with: curl -L -o fbmgr-preview.apk <EAS-build-URL>"
    exit 1
fi

# Sanity-check device is connected.
DEVICES=$(adb devices | sed 1d | grep -c "device$" || true)
if [ "$DEVICES" -eq 0 ]; then
    echo "[install-apk] ✗ No Android device connected via USB."
    echo "  1. Connect phone via USB"
    echo "  2. On phone: Settings → About phone → tap Build number 7 times → enable Developer Options"
    echo "  3. On phone: Developer Options → enable USB debugging"
    echo "  4. Plug in cable, accept the 'Allow USB debugging?' prompt on the phone"
    echo "  5. Re-run this script."
    exit 1
fi

echo "[install-apk] Installing $APK_PATH..."
adb install -r "$APK_PATH"

echo ""
echo "[install-apk] ✓ Installed. Launching app..."
adb shell monkey -p "$APP_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null

echo ""
echo "[install-apk] Tailing push-related log lines (Ctrl-C to stop):"
echo "  Look for: '[Push] Expo push token: ExponentPushToken[...]'"
echo "  And:      '[Push] Token registered with backend'"
echo "  Or any:   '[Push] Firebase is not initialized' / '[Push] Permission not granted'"
echo "─────────────────────────────────────────────────────────────────"
adb logcat -c
adb logcat ReactNativeJS:V "*:S" | grep --line-buffered -iE "push|notif|fcm|firebase|token"
