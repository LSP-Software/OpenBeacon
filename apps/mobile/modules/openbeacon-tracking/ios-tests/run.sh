#!/usr/bin/env bash
set -euo pipefail

if ! command -v swiftc >/dev/null; then
  echo "Skipping the iOS tracking core checks: they need swiftc."
  exit 0
fi

dir="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
swiftc "$dir/../ios/Core/SpeedLimitPack.swift" "$dir/drives/main.swift" -o "$out/drives-tests"
"$out/drives-tests" "$dir/../../../../speed-limit-packs/testVectors/speed-limit-pack-v1.json"
swiftc "$dir/../ios/Core/DriveRecordCodec.swift" "$dir/../ios/Core/DriveDetector.swift" "$dir/DriveDetectorChecks.swift" "$dir/detector/main.swift" -o "$out/detector-tests"
"$out/detector-tests" "$dir/../test-cases/drive-detection-v1.json"
swiftc "$dir/../ios/Core/SpeedLimitPack.swift" "$dir/../ios/Core/DriveRecordCodec.swift" "$dir/../ios/Core/DriveDetector.swift" "$dir/../ios/Core/SpeedingFinder.swift" "$dir/speeding/main.swift" -o "$out/speeding-tests"
"$out/speeding-tests" "$dir/../test-cases/speeding-v1.json"
swiftc "$dir/../ios/Core/DriveRecordCodec.swift" "$dir/../ios/Core/DriveDetector.swift" "$dir/../ios/Core/DrivingEventFinder.swift" "$dir/DrivingEventChecks.swift" "$dir/events/main.swift" -o "$out/events-tests"
"$out/events-tests" "$dir/../test-cases/driving-events-v1.json"
swiftc "$dir/../ios/Core/DriveRecordCodec.swift" "$dir/../ios/Core/DriveDetector.swift" "$dir/../ios/Core/CrashDetector.swift" "$dir/../ios/Core/CrashCountdown.swift" "$dir/CrashChecks.swift" "$dir/crash/main.swift" -o "$out/crash-tests"
"$out/crash-tests" "$dir/../test-cases/crash-detection-v1.json"
swiftc "$dir/../ios/Core/CrashAlertCodec.swift" "$dir/crashalert/main.swift" -o "$out/crash-alert-tests"
"$out/crash-alert-tests" "$dir/../../../../../packages/encryption/src/testVectors/crash-alert-v1.json"

if [ "$(uname)" != "Darwin" ]; then
  echo "Skipping the CryptoKit checks: they need macOS."
  exit 0
fi

swiftc "$dir"/../ios/Core/*.swift "$dir/DriveRecordChecks.swift" "$dir/main.swift" -o "$out/core-tests"
"$out/core-tests" "$dir/../../../../../packages/encryption/src/testVectors/group-payload-interop-v1.json" "$dir/../../../../../packages/encryption/src/testVectors/tracking-point-v2.json" "$dir/../../../../../packages/encryption/src/testVectors/drive-record-v1.json"
