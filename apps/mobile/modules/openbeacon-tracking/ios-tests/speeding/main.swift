import Foundation

struct FixedRoads: SpeedLimitRoads {
  let pieces: [PackRoadPiece]

  func roadsNear(latitude: Double, longitude: Double, radiusMeters: Double) -> [PackRoadPiece]? { pieces }
}

let json = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
let origin = json["origin"] as! [String: Double]
let originLatitude = origin["latitude"]!
let originLongitude = origin["longitude"]!
let metersPerLongitude = 111_320.0 * cos(originLatitude * .pi / 180)
let startTime = (json["startTime"] as! NSNumber).int64Value
var failures = 0

func check(_ passed: Bool, _ message: String) {
  if !passed {
    failures += 1
    print("FAIL: \(message)")
  }
}

func limit(_ value: [Int]) -> RoadLimit {
  RoadLimit(source: RoadLimitSource(rawValue: value[0])!, tenthsKmh: value[1])
}

for case let testCase as [String: Any] in json["cases"] as! [Any] {
  let name = testCase["name"] as! String
  let roadsJson = testCase["roads"] as! [[String: Any]]
  let pieces = roadsJson.enumerated().map { index, road in
    let points = road["points"] as! [[Double]]
    return PackRoadPiece(
      roadId: index,
      roadClass: 1,
      oneway: road["oneway"] as! Bool,
      forward: limit(road["forward"] as! [Int]),
      backward: limit(road["backward"] as! [Int]),
      lonE5: points.map { Int(((originLongitude + $0[0] / metersPerLongitude) * 1e5).rounded()) },
      latE5: points.map { Int(((originLatitude + $0[1] / 111_320.0) * 1e5).rounded()) }
    )
  }
  let start = testCase["start"] as! [Double]
  var x = start[0]
  var y = start[1]
  var time = startTime
  var fixes: [DriveFix] = []
  for step in testCase["steps"] as! [[String: Any]] {
    if let pause = step["pause"] as? Int {
      time += Int64(pause) * 1_000
      continue
    }
    let move = step["move"] as! [String: Any]
    let speed = (move["speed"] as! NSNumber).doubleValue
    let every = (move["every"] as? Int) ?? 1
    let heading = ((move["heading"] as? NSNumber)?.doubleValue ?? 90) * .pi / 180
    for _ in 0..<(move["count"] as! Int) {
      time += Int64(every) * 1_000
      x += speed * Double(every) * sin(heading)
      y += speed * Double(every) * cos(heading)
      fixes.append(
        DriveFix(
          timeMillis: time,
          latitude: originLatitude + y / 111_320.0,
          longitude: originLongitude + x / metersPerLongitude,
          speed: speed,
          accuracy: 5,
          batterySaver: (move["batterySaver"] as? Bool) ?? false
        )
      )
    }
  }
  let noPack = (testCase["noPack"] as? Bool) ?? false
  let result = SpeedingFinder.find(fixes, roads: noPack ? nil : FixedRoads(pieces: pieces))
  check(result.checked == (testCase["checked"] as! Bool), "\(name): checked")
  let expected = testCase["events"] as! [[String: Any]]
  check(result.events.count == expected.count, "\(name): \(result.events.count) events")
  for (want, got) in zip(expected, result.events) {
    check(got.type == .speeding, "\(name): type")
    check(abs(got.timeOffsetSeconds - (want["offset"] as! NSNumber).doubleValue) < 0.001, "\(name): offset")
    check(abs(got.durationSeconds - (want["duration"] as! NSNumber).doubleValue) < 0.001, "\(name): duration")
    check(abs(got.peak - (want["peak"] as! NSNumber).doubleValue) < 0.01, "\(name): peak")
    check(abs((got.limit?.speed ?? 0) - (want["limit"] as! NSNumber).doubleValue / 36) < 0.001, "\(name): limit")
    check(got.limit?.source == SpeedLimitSource(name: want["source"] as! String), "\(name): source")
  }
}

if failures > 0 {
  print("\(failures) speeding check(s) failed")
  exit(1)
}
print("Speeding checks passed")
