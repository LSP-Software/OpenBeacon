import Foundation

func runDrivingEventChecks(casesPath: String, check: (Bool, String) -> Void) throws {
  let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: casesPath))) as! [String: Any]
  let startTime = (file["startTime"] as! NSNumber).int64Value
  let origin = file["origin"] as! [String: NSNumber]

  func vector(_ value: Any?) -> [Double] {
    (value as! [NSNumber]).map(\.doubleValue)
  }

  func run(_ testCase: [String: Any]) -> FoundDrivingEvents {
    let latitude = origin["latitude"]!.doubleValue
    var longitude = origin["longitude"]!.doubleValue
    var speed = (testCase["from"] as! NSNumber).doubleValue
    var time = startTime
    var fixes = [DriveFix(timeMillis: time, latitude: latitude, longitude: longitude, speed: speed, accuracy: 5, batterySaver: false)]
    var seconds: [(slope: Double, accel: String?, tilt: Bool)] = []

    func add(_ segments: [[String: Any]]) {
      for segment in segments {
        if let repeating = segment["repeat"] as? [String: Any] {
          for _ in 0..<(repeating["times"] as! NSNumber).intValue { add(repeating["segments"] as! [[String: Any]]) }
          continue
        }
        let every = (segment["every"] as? NSNumber)?.intValue ?? 1
        let count = (segment["seconds"] as! NSNumber).intValue / every
        let from = speed
        let to = (segment["to"] as! NSNumber).doubleValue
        for step in 1...count {
          let next = from + (to - from) * Double(step) / Double(count)
          for _ in 0..<every {
            seconds.append((slope: (next - speed) / Double(every), accel: segment["accel"] as? String, tilt: segment["tilt"] as? Bool ?? false))
          }
          speed = next
          time += Int64(every) * 1_000
          longitude += speed * Double(every) / (111_320.0 * cos(latitude * .pi / 180))
          fixes.append(DriveFix(timeMillis: time, latitude: latitude, longitude: longitude, speed: speed, accuracy: 5, batterySaver: segment["batterySaver"] as? Bool ?? false))
        }
      }
    }
    add(testCase["segments"] as! [[String: Any]])

    let finder = DrivingEventFinder()
    let phone = file["phone"] as! [String: Any]
    var up = vector(phone["up"])
    var forward = vector(phone["forward"])
    let lag = (testCase["accelLagSeconds"] as? NSNumber)?.intValue ?? 0
    var samples: [AccelerometerSample] = []
    for (index, second) in seconds.enumerated() {
      if second.accel == "none" { continue }
      let slope = second.accel == nil ? (index - lag >= 0 && index - lag < seconds.count ? seconds[index - lag].slope : 0) : 0
      let side = [up[1] * forward[2] - up[2] * forward[1], up[2] * forward[0] - up[0] * forward[2], up[0] * forward[1] - up[1] * forward[0]]
      let angle = 40.0 * .pi / 180
      let gravity = second.tilt ? (0..<3).map { up[$0] * cos(angle) + side[$0] * sin(angle) } : up
      for sample in 0..<10 {
        let at = startTime + Int64(index) * 1_000 + Int64(sample) * 100
        let value: [Double]
        switch second.accel {
        case "bump": value = (0..<3).map { gravity[$0] * (9.81 + (sample % 2 == 0 ? 8 : -8)) + (sample == 3 ? forward[$0] * 6 : 0) }
        case "drop": value = sample < 5 ? gravity.map { $0 * 0.5 } : (0..<3).map { forward[$0] * 25 + gravity[$0] * 9.81 }
        case "turn": value = (0..<3).map { gravity[$0] * 9.81 + side[$0] * 5 }
        case "knock": value = (0..<3).map { gravity[$0] * 9.81 + (sample < 5 ? 0 : forward[$0] * 25) }
        default: value = (0..<3).map { gravity[$0] * 9.81 + forward[$0] * slope }
        }
        samples.append(AccelerometerSample(timeMillis: at, x: value[0], y: value[1], z: value[2]))
      }
      if second.accel == "knock" {
        let dropped = file["dropped"] as! [String: Any]
        up = vector(dropped["up"])
        forward = vector(dropped["forward"])
      }
    }
    var chunks: [[AccelerometerSample]] = []
    var index = 0
    while index < samples.count {
      chunks.append(Array(samples[index..<min(index + 100, samples.count)]))
      index += 100
    }
    for chunk in chunks.reversed() { finder.onAccelerometer(chunk) }
    for signal in testCase["signals"] as? [[String: Any]] ?? [] {
      finder.onPhoneUse(PhoneUseChange(
        timeMillis: startTime + (signal["at"] as! NSNumber).int64Value * 1_000,
        signal: PhoneUseSignal(rawValue: signal["type"] as! String)!
      ))
    }
    return finder.find(fixes)
  }

  for testCase in file["cases"] as! [[String: Any]] {
    let name = testCase["name"] as! String
    let found = run(testCase)
    let counts = testCase["counts"] as! [String: NSNumber]
    for type in DrivingEventType.allCases {
      let typeName = ["", "HARD_BRAKING", "RAPID_ACCELERATION", "SPEEDING", "PHONE_USE"][type.rawValue]
      check(found.counts[type] == (counts[typeName]?.intValue ?? 0), "\(name): \(typeName) count")
      if let kept = testCase["kept"] as? [String: NSNumber] {
        check(found.events.prefix(48).filter { $0.type == type }.count == (kept[typeName]?.intValue ?? 0), "\(name): \(typeName) kept")
      }
    }
    func matches(_ want: [String: Any], _ event: DrivingEvent?, _ label: String) {
      guard let event else {
        check(false, "\(name): \(label) missing")
        return
      }
      check(DrivingEventType(name: want["type"] as! String) == event.type, "\(name): \(label) type")
      if let start = want["start"] as? NSNumber { check(event.timeOffsetSeconds.rounded() == start.doubleValue, "\(name): \(label) start") }
      if let duration = want["duration"] as? NSNumber { check(abs(event.durationSeconds - duration.doubleValue) < 0.001, "\(name): \(label) duration") }
      if let peak = want["peak"] as? NSNumber { check(abs(event.peak - peak.doubleValue) <= 0.05, "\(name): \(label) peak") }
    }
    if let events = testCase["events"] as? [[String: Any]] {
      check(events.count == found.events.count, "\(name): number of events")
      for (index, want) in events.enumerated() { matches(want, index < found.events.count ? found.events[index] : nil, "event \(index)") }
    }
    for (index, want) in (testCase["leading"] as? [[String: Any]] ?? []).enumerated() {
      matches(want, index < found.events.count ? found.events[index] : nil, "leading \(index)")
    }
  }
}
