#!/usr/bin/env bash
set -euo pipefail

tracking_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tracking_module="apps/mobile/modules/openbeacon-tracking"

if [[ "${1:-}" == "--if-changed" ]]; then
  if [[ -n "${CI:-}" ]]; then
    echo "Skipping Room tracking tests on hosted CI; they run in local ci."
    exit 0
  fi
  base="$(git -C "$tracking_root" merge-base HEAD main 2>/dev/null || git -C "$tracking_root" merge-base HEAD origin/main 2>/dev/null || true)"
  if [[ -n "$base" ]]; then
    changed="$(
      git -C "$tracking_root" diff --name-only "$base" -- "$tracking_module" scripts/test-tracking-room.sh
      git -C "$tracking_root" ls-files --others --exclude-standard -- "$tracking_module"
    )"
    if [[ -z "$changed" ]]; then
      echo "Skipping Room tracking tests: no changes under $tracking_module since main."
      exit 0
    fi
  fi
fi

android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
adb_command="$android_home/platform-tools/adb"
emulator_command="$android_home/emulator/emulator"
if [[ ! -x "$adb_command" ]]; then
  echo "WARNING: Skipping Room tracking tests: no Android SDK found at $android_home. Set ANDROID_HOME to run them." >&2
  exit 0
fi

started_emulator=""
serial="${ANDROID_SERIAL:-$("$adb_command" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }')}"
if [[ -z "$serial" ]]; then
  avd="$([[ -x "$emulator_command" ]] && "$emulator_command" -list-avds 2>/dev/null | head -n 1 || true)"
  if [[ -z "$avd" ]]; then
    echo "WARNING: Skipping Room tracking tests: no connected device and no Android emulator AVD to boot." >&2
    exit 0
  fi
  existing="$("$adb_command" devices | awk 'NR > 1 { print $1 }')"
  echo "Booting emulator $avd for Room tracking tests..."
  "$emulator_command" -avd "$avd" -no-window -no-audio -no-boot-anim -no-snapshot-save >/dev/null 2>&1 &
  started_emulator="$!"
  for _ in $(seq 1 120); do
    serial="$("$adb_command" devices | awk 'NR > 1 && $1 ~ /^emulator-/ { print $1 }' | grep -vxF "$existing" | head -n 1 || true)"
    [[ -n "$serial" ]] && break
    sleep 1
  done
  [[ -n "$serial" ]] || { echo "Emulator $avd did not appear in adb." >&2; kill "$started_emulator"; exit 1; }
fi

test_package="expo.modules.openbeacontracking.test"
test_apk="$tracking_root/$tracking_module/android/build/outputs/apk/androidTest/debug/openbeacon-tracking-debug-androidTest.apk"

cleanup() {
  "$adb_command" -s "$serial" uninstall "$test_package" >/dev/null 2>&1 || true
  if [[ -n "$started_emulator" ]]; then
    "$adb_command" -s "$serial" emu kill >/dev/null 2>&1 || kill "$started_emulator" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ ! -d "$tracking_root/apps/mobile/android" ]]; then
  (cd "$tracking_root/apps/mobile" && bunx expo prebuild --platform android --no-install)
fi
(cd "$tracking_root/apps/mobile/android" && ./gradlew :openbeacon-tracking:assembleDebugAndroidTest --no-daemon -q)
timeout 300 "$adb_command" -s "$serial" wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'
"$adb_command" -s "$serial" install -r "$test_apk"
result="$("$adb_command" -s "$serial" shell am instrument -w "$test_package/expo.modules.openbeacontracking.queue.RoomQueueInstrumentation")"
printf '%s\n' "$result"
[[ "$result" == *"Room queue privacy tests passed"* ]]
