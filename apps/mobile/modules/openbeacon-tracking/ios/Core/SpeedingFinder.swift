import Foundation

protocol SpeedLimitRoads {
  func roadsNear(latitude: Double, longitude: Double, radiusMeters: Double) -> [PackRoadPiece]?
}

struct SpeedLimitPackSet: SpeedLimitRoads {
  let packs: [SpeedLimitPack]

  func roadsNear(latitude: Double, longitude: Double, radiusMeters: Double) -> [PackRoadPiece]? {
    let lonE5 = longitude * 1e5
    let latE5 = latitude * 1e5
    let covering = packs.filter {
      lonE5 >= Double($0.minLonE5) && lonE5 <= Double($0.maxLonE5) && latE5 >= Double($0.minLatE5) && latE5 <= Double($0.maxLatE5)
    }
    if covering.isEmpty { return nil }
    return covering.flatMap { (try? $0.roadsNear(latitude: latitude, longitude: longitude, radiusMeters: radiusMeters)) ?? [] }
  }
}

struct SpeedingResult: Equatable {
  var checked: Bool
  var events: [DrivingEvent]
}

enum SpeedingFinder {
  static let matchMeters = 20.0
  static let ambiguousMeters = 30.0
  static let maxHeadingDegrees = 30.0
  static let minHeadingMeters = 3.0
  static let maxGapMillis: Int64 = 5_000
  static let minSpeedingMillis: Int64 = 15_000
  static let overRatio = 1.1
  static let overMargin = 0.89408
  private static let roundingAllowance = 0.02
  private static let metersPerDegree = 111_320.0

  static func find(_ fixes: [DriveFix], roads: SpeedLimitRoads?) -> SpeedingResult {
    guard let roads, !fixes.isEmpty else { return SpeedingResult(checked: false, events: []) }
    let matched = fixes.indices.map { match(fixes, $0, roads) }
    let limits: [RoadLimit?] = matched.indices.map { index in
      guard let limit = matched[index] else { return nil }
      let agrees = [index - 1, index + 1].contains { other in
        fixes.indices.contains(other) &&
          matched[other] == limit &&
          abs(fixes[other].timeMillis - fixes[index].timeMillis) <= maxGapMillis
      }
      return agrees ? limit : nil
    }

    var events: [(Double, DrivingEvent)] = []
    var runStart = -1
    for index in 0...fixes.count {
      let speeding = index < fixes.count && isSpeeding(fixes[index], limits[index])
      let continues = speeding && runStart >= 0 && fixes[index].timeMillis - fixes[index - 1].timeMillis <= maxGapMillis
      if continues { continue }
      if runStart >= 0 {
        if let event = speedingEvent(fixes, limits, runStart, index - 1) { events.append(event) }
        runStart = -1
      }
      if speeding { runStart = index }
    }

    return SpeedingResult(
      checked: limits.contains { $0 != nil },
      events: events.enumerated().sorted { $0.element.0 == $1.element.0 ? $0.offset < $1.offset : $0.element.0 > $1.element.0 }.map { $0.element.1 }
    )
  }

  private static func isSpeeding(_ fix: DriveFix, _ limit: RoadLimit?) -> Bool {
    guard let limit, limit.tenthsKmh != 0, let speed = fix.speed else { return false }
    return speed >= Double(limit.tenthsKmh) / 36 * overRatio + overMargin - roundingAllowance
  }

  private static func speedingEvent(_ fixes: [DriveFix], _ limits: [RoadLimit?], _ from: Int, _ to: Int) -> (Double, DrivingEvent)? {
    let durationMillis = fixes[to].timeMillis - fixes[from].timeMillis
    guard durationMillis >= minSpeedingMillis else { return nil }
    var peakIndex = from
    for index in from...to where (fixes[index].speed ?? 0) > (fixes[peakIndex].speed ?? 0) { peakIndex = index }
    let peakFix = fixes[peakIndex]
    guard let limit = limits[peakIndex] else { return nil }
    let limitSpeed = Double(limit.tenthsKmh) / 36
    let peak = peakFix.speed ?? 0
    let duration = Double(durationMillis) / 1_000
    let event = DrivingEvent(
      type: .speeding,
      timeOffsetSeconds: Double(fixes[from].timeMillis - fixes[0].timeMillis) / 1_000,
      durationSeconds: duration,
      latitude: peakFix.latitude,
      longitude: peakFix.longitude,
      peak: peak,
      limit: SpeedLimit(speed: limitSpeed, source: limit.source == .posted ? .posted : .roadType)
    )
    return ((peak - limitSpeed) / limitSpeed * duration, event)
  }

  private static func match(_ fixes: [DriveFix], _ index: Int, _ roads: SpeedLimitRoads) -> RoadLimit? {
    let fix = fixes[index]
    guard !fix.batterySaver, fix.speed != nil, let heading = heading(fixes, index),
      let pieces = roads.roadsNear(latitude: fix.latitude, longitude: fix.longitude, radiusMeters: ambiguousMeters)
    else { return nil }
    let metersPerLongitude = metersPerDegree * cos(fix.latitude * .pi / 180)
    var best: Double?
    var nearby: [RoadLimit] = []

    for piece in pieces {
      var pieceDistance: Double?
      var pieceLimit: RoadLimit?
      for point in 0..<(piece.lonE5.count - 1) {
        let ax = (Double(piece.lonE5[point]) / 1e5 - fix.longitude) * metersPerLongitude
        let ay = (Double(piece.latE5[point]) / 1e5 - fix.latitude) * metersPerDegree
        let bx = (Double(piece.lonE5[point + 1]) / 1e5 - fix.longitude) * metersPerLongitude
        let by = (Double(piece.latE5[point + 1]) / 1e5 - fix.latitude) * metersPerDegree
        let dx = bx - ax
        let dy = by - ay
        let length = dx * dx + dy * dy
        if length == 0 { continue }
        let along = min(max(-(ax * dx + ay * dy) / length, 0), 1)
        let distance = hypot(ax + dx * along, ay + dy * along)
        if distance > ambiguousMeters { continue }
        let turn = angleBetween(heading, atan2(dx, dy) * 180 / .pi)
        let limit: RoadLimit
        if turn <= maxHeadingDegrees {
          limit = piece.forward
        } else if turn >= 180 - maxHeadingDegrees && !piece.oneway {
          limit = piece.backward
        } else {
          continue
        }
        if pieceDistance == nil || distance < pieceDistance! {
          pieceDistance = distance
          pieceLimit = limit
        }
      }
      guard let pieceDistance, let pieceLimit else { continue }
      if !nearby.contains(pieceLimit) { nearby.append(pieceLimit) }
      if best == nil || pieceDistance < best! { best = pieceDistance }
    }

    guard let best, best <= matchMeters, nearby.count == 1, nearby[0].source != .unknown else { return nil }
    return nearby[0]
  }

  private static func heading(_ fixes: [DriveFix], _ index: Int) -> Double? {
    let fix = fixes[index]
    let before = index > 0 && fix.timeMillis - fixes[index - 1].timeMillis <= maxGapMillis ? fixes[index - 1] : fix
    let after = index + 1 < fixes.count && fixes[index + 1].timeMillis - fix.timeMillis <= maxGapMillis ? fixes[index + 1] : fix
    let dx = (after.longitude - before.longitude) * metersPerDegree * cos(fix.latitude * .pi / 180)
    let dy = (after.latitude - before.latitude) * metersPerDegree
    if hypot(dx, dy) < minHeadingMeters { return nil }
    return atan2(dx, dy) * 180 / .pi
  }

  private static func angleBetween(_ first: Double, _ second: Double) -> Double {
    let difference = abs(first - second).truncatingRemainder(dividingBy: 360)
    return difference > 180 ? 360 - difference : difference
  }
}
