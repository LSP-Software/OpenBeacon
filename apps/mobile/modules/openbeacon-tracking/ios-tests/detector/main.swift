import Foundation

var failures = 0
try runDriveDetectorChecks(casesPath: CommandLine.arguments[1]) { passed, message in
  if !passed {
    failures += 1
    print("FAIL: \(message)")
  }
}
if failures > 0 {
  print("\(failures) drive detector check(s) failed")
  exit(1)
}
print("Drive detector checks passed")
