#!/usr/bin/env bash
# Source this file to set up the Android toolchain for local builds:
#   source scripts/android-env.sh
#
# Detects standard install locations on Windows + Linux + macOS.
# Idempotent — safe to source multiple times.

# ---- ANDROID_HOME -----------------------------------------------------------
if [ -z "$ANDROID_HOME" ]; then
    for candidate in \
        "$HOME/AppData/Local/Android/Sdk" \
        "/c/Users/$USER/AppData/Local/Android/Sdk" \
        "$HOME/Library/Android/sdk" \
        "$HOME/Android/Sdk" \
        "/opt/android-sdk"
    do
        if [ -d "$candidate" ]; then
            export ANDROID_HOME="$candidate"
            break
        fi
    done
fi

if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
    echo "[android-env] ✗ ANDROID_HOME not found. Install Android Studio + Android SDK first."
    return 1 2>/dev/null || exit 1
fi

# ---- JAVA_HOME (use Android Studio's bundled JBR) ---------------------------
if [ -z "$JAVA_HOME" ]; then
    for candidate in \
        "/c/Program Files/Android/Android Studio/jbr" \
        "$HOME/.gradle/jdks/jdk-17"* \
        "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
        "/usr/lib/jvm/java-17-openjdk-amd64" \
        "/usr/lib/jvm/default-java"
    do
        if [ -d "$candidate" ]; then
            export JAVA_HOME="$candidate"
            break
        fi
    done
fi

# ---- PATH -------------------------------------------------------------------
case ":$PATH:" in
    *":$ANDROID_HOME/platform-tools:"*) ;;
    *) export PATH="$ANDROID_HOME/platform-tools:$PATH" ;;
esac
case ":$PATH:" in
    *":$ANDROID_HOME/emulator:"*) ;;
    *) export PATH="$ANDROID_HOME/emulator:$PATH" ;;
esac
if [ -n "$JAVA_HOME" ]; then
    case ":$PATH:" in
        *":$JAVA_HOME/bin:"*) ;;
        *) export PATH="$JAVA_HOME/bin:$PATH" ;;
    esac
fi

echo "[android-env] ✓ ANDROID_HOME = $ANDROID_HOME"
echo "[android-env] ✓ JAVA_HOME    = $JAVA_HOME"
echo "[android-env] ✓ adb          = $(command -v adb 2>/dev/null || echo MISSING)"
echo "[android-env] ✓ java         = $(command -v java 2>/dev/null || echo MISSING)"
