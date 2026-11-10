#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"

if [[ ! -d "$android_home/platforms" ]]; then
  if [[ -n "${CI:-}" ]]; then
    echo "No Android SDK found at $android_home. The offline tracking queue tests need one; set ANDROID_HOME." >&2
    exit 1
  fi
  echo "WARNING: Skipping offline tracking queue tests: no Android SDK found at $android_home. Set ANDROID_HOME to run them." >&2
  exit 0
fi
export ANDROID_HOME="$android_home"

if [[ ! -d "$repo_root/apps/mobile/android" ]]; then
  (cd "$repo_root/apps/mobile" && bunx expo prebuild --platform android --no-install)
fi
cd "$repo_root/apps/mobile/android"
./gradlew :openbeacon-tracking:testDebugUnitTest --no-daemon -q
