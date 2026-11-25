import Foundation

func runCrashChecks(casesPath: String, check: (Bool, String) -> Void) throws {
  let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: casesPath))) as! [String: Any]
  let startTime = (file["startTime"] as! NSNumber).int64Value
  let origin = file["origin"] as! [String: NSNumber]
  let latitude = origin["latitude"]!.doubleValue
  let millis = { (seconds: NSNumber) in Int64((seconds.doubleValue * 1_000).rounded()) }

  for testCase in file["cases"] as! [[String: Any]] {
    let name = testCase["name"] as! String
    var longitude = origin["longitude"]!.doubleValue
    var time = startTime
    var alertOpen = false
    let detector = CrashDetector(isAlertOpen: { alertOpen })
    var suspicions: [CrashSuspicion] = []
    for step in testCase["steps"] as! [[String: Any]] {
      if let alert = step["alert"] as? Bool {
        alertOpen = alert
      } else if let move = step["move"] as? [String: Any] {
        let speed = (move["speed"] as! NSNumber).doubleValue
        let every = (move["every"] as! NSNumber).int64Value
        for _ in 0..<(move["count"] as! NSNumber).intValue {
          time += every * 1_000
          longitude += speed * Double(every) / (111_320.0 * cos(latitude * .pi / 180))
          let fix = DriveFix(
            timeMillis: time,
            latitude: latitude,
            longitude: longitude,
            speed: speed,
            accuracy: 5,
            batterySaver: move["batterySaver"] as? Bool ?? false
          )
          if let suspicion = detector.onFix(fix, inDrive: move["drive"] as? Bool ?? true) { suspicions.append(suspicion) }
        }
      } else if let jolt = step["jolt"] as? [String: NSNumber] {
        let at = jolt["at"].map { startTime + millis($0) } ?? time + millis(jolt["after"]!)
        if let suspicion = detector.onMotion(timeMillis: at, magnitude: jolt["g"]!.doubleValue * 9.80665) { suspicions.append(suspicion) }
      }
    }
    let expected = testCase["suspicions"] as! [[String: NSNumber]]
    check(expected.count == suspicions.count, "\(name): \(expected.count) suspicion(s), got \(suspicions.count)")
    for (want, got) in zip(expected, suspicions) {
      check(startTime + millis(want["time"]!) == got.timeMillis, "\(name): suspicion time")
      check(abs(want["speedBefore"]!.doubleValue - got.speedBefore) < 0.05, "\(name): speed before")
    }
  }

  let suspicion = CrashSuspicion(timeMillis: 1_000_000, latitude: 51.5, longitude: -0.1, speedBefore: 18.8)
  let start: Int64 = 1_020_000
  let real = CrashCountdown.start(suspicion: suspicion, test: false, nowMillis: start)
  check(real.secondsLeft(nowMillis: start) == 60, "countdown: starts at 60 s")
  check(real.tick(nowMillis: start + 59_999).phase == .counting, "countdown: still counting before the end")
  check(real.tick(nowMillis: start + 60_000).phase == .sent, "countdown: sends at the end")
  check(real.imOk().phase == .cancelled, "countdown: I'm OK sends nothing")
  check(real.imOk().tick(nowMillis: start + 90_000).phase == .cancelled, "countdown: a cancelled countdown never sends")
  check(real.sendNow().phase == .sent, "countdown: Send now sends")
  check(real.sendNow().imOk().phase == .saidOk, "countdown: I'm OK after sending tells the groups")
  let test = CrashCountdown.start(suspicion: suspicion, test: true, nowMillis: start)
  check(test.secondsLeft(nowMillis: start) == 10, "Try it: starts at 10 s")
  check(test.tick(nowMillis: start + 10_000).phase == .testFinished, "Try it: finishes without sending")
  check(test.sendNow().phase == .testFinished, "Try it: Send now finishes without sending")
}
