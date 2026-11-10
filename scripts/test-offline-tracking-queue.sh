#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$android_home" ]]; then
  android_home="$HOME/Android/Sdk"
  if [[ ! -d "$android_home" && -d "$HOME/Library/Android/sdk" ]]; then
    android_home="$HOME/Library/Android/sdk"
  fi
fi

if [[ ! -d "$android_home/platforms" ]]; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "No Android SDK found at $android_home. The offline tracking queue tests need one; set ANDROID_HOME." >&2
    exit 1
  fi
  echo "WARNING: Skipping offline tracking queue tests: no Android SDK found at $android_home. Set ANDROID_HOME to run them." >&2
  exit 0
fi
export ANDROID_HOME="$android_home"

prebuilt=""
if [[ -d "$repo_root/apps/mobile/android" ]]; then
  prebuilt="true"
else
  (cd "$repo_root/apps/mobile" && bunx expo prebuild --platform android --no-install)
fi
cd "$repo_root/apps/mobile/android"
gradle_status=0
./gradlew :openbeacon-tracking:testDebugUnitTest --no-daemon -q || gradle_status="$?"
if ((gradle_status != 0)); then
  if [[ -n "$prebuilt" ]]; then
    echo "Gradle failed using the existing apps/mobile/android. It may be a stale prebuild; delete it or run 'bunx expo prebuild --platform android --clean' in apps/mobile, then retry." >&2
  fi
  exit "$gradle_status"
fi
