import Foundation

func runDriveDetectorChecks(casesPath: String, check: (Bool, String) -> Void) throws {
  let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: casesPath))) as! [String: Any]
  let startTime = (file["startTime"] as! NSNumber).int64Value
  let origin = file["origin"] as! [String: NSNumber]

  func run(_ testCase: [String: Any], _ replayAt: Int?) -> [DetectedDrive] {
    let name = testCase["name"] as! String
    let latitude = origin["latitude"]!.doubleValue
    var longitude = origin["longitude"]!.doubleValue
    var time = startTime
    var detector = DriveDetector()
    var drives: [DetectedDrive] = []
    for (index, step) in (testCase["steps"] as! [[String: Any]]).enumerated() {
      if index == replayAt {
        let retained = detector.retainedFixes
        detector = DriveDetector()
        for fix in retained {
          if let drive = detector.onFix(fix).finished { drives.append(drive) }
        }
      }
      if let move = step["move"] as? [String: Any] {
        let speed = (move["speed"] as! NSNumber).doubleValue
        let every = (move["every"] as! NSNumber).int64Value
        for _ in 0..<(move["count"] as! NSNumber).intValue {
          time += every * 1_000
          longitude += speed * Double(every) / (111_320.0 * cos(latitude * .pi / 180))
          let fix = DriveFix(
            timeMillis: time,
            latitude: latitude,
            longitude: longitude,
            speed: (move["reportSpeed"] as? Bool ?? true) ? speed : nil,
            accuracy: 5,
            batterySaver: move["batterySaver"] as? Bool ?? false
          )
          if let drive = detector.onFix(fix).finished { drives.append(drive) }
        }
      } else if let jitter = step["jitter"] as? [String: NSNumber] {
        let every = jitter["every"]!.int64Value
        let offset = jitter["metres"]!.doubleValue / (111_320.0 * cos(latitude * .pi / 180))
        for count in 1...jitter["count"]!.intValue {
          time += every * 1_000
          let fix = DriveFix(
            timeMillis: time,
            latitude: latitude,
            longitude: count % 2 == 1 ? longitude + offset : longitude,
            speed: jitter["speed"]?.doubleValue,
            accuracy: 5,
            batterySaver: false
          )
          if let drive = detector.onFix(fix).finished { drives.append(drive) }
        }
      } else if step["arrive"] != nil {
        if let drive = detector.onPlaceArrive() { drives.append(drive) }
      } else if step["interrupt"] != nil {
        if let drive = detector.interrupt() { drives.append(drive) }
      } else if step["discard"] != nil {
        detector.discard()
      } else if let expect = step["expect"] as? [String: Bool] {
        check(detector.wantsFastFixes == expect["fast"]!, "\(name): fast fixes at step \(index)")
        check(detector.recording == expect["recording"]!, "\(name): recording at step \(index)")
      }
    }
    return drives
  }

  func verify(_ testCase: [String: Any], _ drives: [DetectedDrive]) {
    let name = testCase["name"] as! String
    let expected = testCase["drives"] as! [[String: NSNumber]]
    check(drives.count == expected.count, "\(name): number of drives")
    for (want, drive) in zip(expected, drives) {
      check(drive.start.timeMillis == startTime + want["start"]!.int64Value * 1_000, "\(name): start")
      check(drive.end.timeMillis == startTime + want["end"]!.int64Value * 1_000, "\(name): end")
      check(drive.durationSeconds == Double(drive.end.timeMillis - drive.start.timeMillis) / 1_000, "\(name): duration")
      check(abs(drive.distanceMeters - want["distance"]!.doubleValue) <= want["distance"]!.doubleValue * 0.005 + 0.5, "\(name): distance")
      check(abs(drive.checkedDistanceMeters - want["checkedDistance"]!.doubleValue) <= want["checkedDistance"]!.doubleValue * 0.005 + 0.5, "\(name): checked distance")
      check(abs(drive.topSpeed - want["topSpeed"]!.doubleValue) <= 0.05, "\(name): top speed")
      check(abs(drive.averageSpeed - drive.distanceMeters / drive.durationSeconds) <= 0.01, "\(name): average speed")
    }
  }

  for testCase in file["cases"] as! [[String: Any]] {
    verify(testCase, run(testCase, nil))
    let steps = testCase["steps"] as! [[String: Any]]
    for at in 1..<steps.count where steps[at]["expect"] == nil {
      verify(testCase, run(testCase, at))
    }
  }
}
