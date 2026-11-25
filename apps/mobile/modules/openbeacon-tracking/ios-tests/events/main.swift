import Foundation

var failures = 0
try runDrivingEventChecks(casesPath: CommandLine.arguments[1]) { passed, message in
  if !passed {
    failures += 1
    print("FAIL: \(message)")
  }
}
if failures > 0 {
  print("\(failures) driving event check(s) failed")
  exit(1)
}
print("Driving event checks passed")
