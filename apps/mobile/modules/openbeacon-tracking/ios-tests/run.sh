#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname)" != "Darwin" ] || ! command -v swiftc >/dev/null; then
  echo "Skipping the iOS tracking core checks: they need macOS with swiftc."
  exit 0
fi

dir="$(cd "$(dirname "$0")" && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
swiftc "$dir"/../ios/Core/*.swift "$dir/DriveRecordChecks.swift" "$dir/DriveDetectorChecks.swift" "$dir/main.swift" -o "$out/core-tests"
"$out/core-tests" "$dir/../../../../../packages/encryption/src/testVectors/group-payload-interop-v1.json" "$dir/../../../../../packages/encryption/src/testVectors/tracking-point-v2.json" "$dir/../../../../../packages/encryption/src/testVectors/drive-record-v1.json" "$dir/../test-cases/drive-detection-v1.json"
