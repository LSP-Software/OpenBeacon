#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_SERIAL:?Set ANDROID_SERIAL to the emulator or device for the tests}"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK directory}"

tracking_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
adb_command="$ANDROID_HOME/platform-tools/adb"
test_package="expo.modules.openbeacontracking.test"
test_apk="$tracking_root/apps/mobile/modules/openbeacon-tracking/android/build/outputs/apk/androidTest/debug/openbeacon-tracking-debug-androidTest.apk"

(cd "$tracking_root/apps/mobile/android" && ./gradlew :openbeacon-tracking:assembleDebugAndroidTest --no-daemon)
"$adb_command" -s "$ANDROID_SERIAL" install -r "$test_apk"
trap '"$adb_command" -s "$ANDROID_SERIAL" uninstall "$test_package" >/dev/null 2>&1 || true' EXIT
result="$("$adb_command" -s "$ANDROID_SERIAL" shell am instrument -w "$test_package/expo.modules.openbeacontracking.queue.RoomQueueInstrumentation")"
printf '%s\n' "$result"
[[ "$result" == *"Room queue privacy tests passed"* ]]
