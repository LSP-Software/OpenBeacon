import Foundation

struct AccelerometerSample: Equatable {
  var timeMillis: Int64
  var x: Double
  var y: Double
  var z: Double
}

enum PhoneUseSignal: String {
  case screenOn = "SCREEN_ON"
  case screenOff = "SCREEN_OFF"
  case unlocked = "UNLOCKED"
  case handheldCallStarted = "HANDHELD_CALL_STARTED"
  case handheldCallEnded = "HANDHELD_CALL_ENDED"
}

struct PhoneUseChange: Equatable {
  var timeMillis: Int64
  var signal: PhoneUseSignal
}

struct FoundDrivingEvents: Equatable {
  var events: [DrivingEvent]
  var counts: [DrivingEventType: Int]
}

final class DrivingEventFinder {
  static let hardAcceleration = 3.1
  static let phoneUseSpeed = 15 / 3.6
  static let minPhoneUseMillis: Int64 = 3_000
  static let confirmFraction = 0.5
  static let freeFallMagnitude = 4.0
  static let maxReorientationDegrees = 20.0
  static let handTiltDegrees = 30.0
  static let handTiltSeconds: Int64 = 2
  static let maxStepSeconds = 2.5
  private static let maxPhoneUseFixGapMillis: Int64 = 30_000
  private static let axisEvidenceAcceleration = 1.5
  private static let minAxisEvidence = 1.0
  private static let baselineSeconds: Int64 = 5
  private static let handBaselineSeconds: Int64 = 3
  private static let baselineMillis: Int64 = 10_000
  private static let maxDurationSeconds = 65_535.0
  private static let rankOrder: [DrivingEventType] = [.phoneUse, .speeding, .hardBraking, .rapidAcceleration]

  private struct Second {
    var x = 0.0
    var y = 0.0
    var z = 0.0
    var samples = 0
    var minMagnitude = Double.greatestFiniteMagnitude

    var mean: [Double] { [x / Double(samples), y / Double(samples), z / Double(samples)] }
  }

  private var seconds: [Int64: Second] = [:]
  private var changes: [PhoneUseChange] = []

  func onAccelerometer(_ samples: [AccelerometerSample]) {
    for sample in samples where sample.x.isFinite && sample.y.isFinite && sample.z.isFinite {
      let key = Self.floorSecond(sample.timeMillis)
      var second = seconds[key] ?? Second()
      second.x += sample.x
      second.y += sample.y
      second.z += sample.z
      second.samples += 1
      second.minMagnitude = min(second.minMagnitude, (sample.x * sample.x + sample.y * sample.y + sample.z * sample.z).squareRoot())
      seconds[key] = second
    }
  }

  func onPhoneUse(_ change: PhoneUseChange) {
    let at = changes.lastIndex { $0.timeMillis <= change.timeMillis }.map { $0 + 1 } ?? 0
    changes.insert(change, at: at)
  }

  func trimBefore(_ timeMillis: Int64) {
    let cutoff = Self.floorSecond(timeMillis - Self.baselineMillis)
    seconds = seconds.filter { $0.key >= cutoff }
    let before = changes.filter { $0.timeMillis < timeMillis }
    if before.isEmpty { return }
    var screen = false
    var unlocked = false
    var call = false
    for change in before {
      switch change.signal {
      case .screenOn: screen = true
      case .screenOff:
        screen = false
        unlocked = false
      case .unlocked:
        screen = true
        unlocked = true
      case .handheldCallStarted: call = true
      case .handheldCallEnded: call = false
      }
    }
    changes.removeAll { $0.timeMillis < timeMillis }
    var state: [PhoneUseChange] = []
    if screen { state.append(PhoneUseChange(timeMillis: timeMillis, signal: .screenOn)) }
    if unlocked { state.append(PhoneUseChange(timeMillis: timeMillis, signal: .unlocked)) }
    if call { state.append(PhoneUseChange(timeMillis: timeMillis, signal: .handheldCallStarted)) }
    changes.insert(contentsOf: state, at: 0)
  }

  func find(_ fixes: [DriveFix]) -> FoundDrivingEvents {
    let found = fixes.count < 2 ? [] : hardEvents(fixes) + phoneUse(fixes)
    var counts: [DrivingEventType: Int] = [:]
    for type in DrivingEventType.allCases { counts[type] = found.filter { $0.type == type }.count }
    return FoundDrivingEvents(events: Self.mostSevereFirst(found), counts: counts)
  }

  static func severity(_ event: DrivingEvent) -> Double {
    switch event.type {
    case .hardBraking, .rapidAcceleration: return event.peak
    case .phoneUse: return event.durationSeconds
    case .speeding:
      guard let limit = event.limit?.speed, limit > 0 else { return 0 }
      return (event.peak - limit) / limit * event.durationSeconds
    }
  }

  static func mostSevereFirst(_ events: [DrivingEvent]) -> [DrivingEvent] {
    let byType = rankOrder.map { type in
      events.filter { $0.type == type }.sorted { a, b in
        let severityA = severity(a)
        let severityB = severity(b)
        if severityA != severityB { return severityA > severityB }
        if a.peak != b.peak { return a.peak > b.peak }
        return a.timeOffsetSeconds < b.timeOffsetSeconds
      }
    }
    let rounds = byType.map(\.count).max() ?? 0
    return (0..<rounds).flatMap { rank in byType.compactMap { rank < $0.count ? $0[rank] : nil } }
  }

  private func slope(_ from: DriveFix, _ to: DriveFix) -> Double? {
    let seconds = Double(to.timeMillis - from.timeMillis) / 1_000
    guard let fromSpeed = from.speed, let toSpeed = to.speed else { return nil }
    if seconds <= 0 || seconds > Self.maxStepSeconds || from.batterySaver || to.batterySaver { return nil }
    return (toSpeed - fromSpeed) / seconds
  }

  private func hardEvents(_ fixes: [DriveFix]) -> [DrivingEvent] {
    let evidence = axisEvidence(fixes)
    let total = (0..<3).map { axis in evidence.reduce(0) { $0 + $1[axis] } }
    var events: [DrivingEvent] = []
    var type: DrivingEventType?
    var runStart = 0
    var peak = 0.0

    func close(_ end: Int) {
      guard let runType = type else { return }
      let from = fixes[runStart]
      let to = fixes[end]
      let sign = runType == .hardBraking ? -1.0 : 1.0
      let others = (0..<3).map { axis in total[axis] - ((runStart + 1)...end).reduce(0) { $0 + evidence[$1][axis] } }
      let othersLength = Self.length(others)
      let forward = othersLength < Self.minAxisEvidence ? nil : others.map { $0 / othersLength }
      guard confirmed(from, to, sign, forward) else { return }
      events.append(DrivingEvent(
        type: runType,
        timeOffsetSeconds: Double(from.timeMillis - fixes[0].timeMillis) / 1_000,
        durationSeconds: Double(to.timeMillis - from.timeMillis) / 1_000,
        latitude: from.latitude,
        longitude: from.longitude,
        peak: peak,
        limit: nil
      ))
    }

    for index in 1..<fixes.count {
      let acceleration = slope(fixes[index - 1], fixes[index])
      var stepType: DrivingEventType?
      if let acceleration {
        if acceleration <= -Self.hardAcceleration { stepType = .hardBraking }
        else if acceleration >= Self.hardAcceleration { stepType = .rapidAcceleration }
      }
      if stepType != type {
        close(index - 1)
        type = stepType
        runStart = index - 1
        peak = 0
      }
      if let acceleration, stepType != nil { peak = max(peak, abs(acceleration)) }
    }
    close(fixes.count - 1)
    return events
  }

  private func axisEvidence(_ fixes: [DriveFix]) -> [[Double]] {
    fixes.indices.map { index in
      var sum = [0.0, 0.0, 0.0]
      if index == 0 { return sum }
      let from = fixes[index - 1]
      let to = fixes[index]
      guard let acceleration = slope(from, to), abs(acceleration) >= Self.axisEvidenceAcceleration else { return sum }
      for second in Self.floorSecond(from.timeMillis)..<Self.ceilSecond(to.timeMillis) {
        guard let gravity = gravityBefore(second), let horizontal = horizontalAt(second, gravity) else { continue }
        for axis in 0..<3 { sum[axis] += horizontal[axis] * acceleration }
      }
      return sum
    }
  }

  private func confirmed(_ from: DriveFix, _ to: DriveFix, _ sign: Double, _ axis: [Double]?) -> Bool {
    let startSecond = Self.floorSecond(from.timeMillis)
    let endSecond = Self.ceilSecond(to.timeMillis)
    guard let gravity = gravityBefore(startSecond) else { return false }
    if let after = average((endSecond + 1)...(endSecond + Self.baselineSeconds)), Self.angleDegrees(gravity, after) > Self.maxReorientationDegrees {
      return false
    }
    if ((startSecond - 1)...(endSecond + 1)).contains(where: { (seconds[$0]?.minMagnitude ?? .greatestFiniteMagnitude) < Self.freeFallMagnitude }) {
      return false
    }
    let gpsAcceleration = abs((to.speed ?? 0) - (from.speed ?? 0)) / (Double(to.timeMillis - from.timeMillis) / 1_000)
    let length = max(1, endSecond - startSecond)
    for shift in Int64(-1)...1 {
      var values: [Double] = []
      for second in (startSecond + shift)..<(startSecond + shift + length) {
        guard let horizontal = horizontalAt(second, gravity) else { break }
        values.append(axis.map { Self.dot(horizontal, $0) * sign } ?? Self.length(horizontal))
      }
      if values.count == Int(length), values.reduce(0, +) / Double(values.count) >= Self.confirmFraction * gpsAcceleration {
        return true
      }
    }
    return false
  }

  private func phoneUse(_ fixes: [DriveFix]) -> [DrivingEvent] {
    let start = fixes[0].timeMillis
    let end = fixes[fixes.count - 1].timeMillis
    var uses: [(Int64, Int64)] = []
    var screenAt: Int64?
    var unlockedAt: Int64?
    var callAt: Int64?
    for change in changes {
      switch change.signal {
      case .screenOn: if screenAt == nil { screenAt = change.timeMillis }
      case .unlocked:
        if screenAt == nil { screenAt = change.timeMillis }
        if unlockedAt == nil { unlockedAt = change.timeMillis }
      case .screenOff:
        if let unlockedAt { uses.append((unlockedAt, change.timeMillis)) }
        if let screenAt, let use = handheld(screenAt, change.timeMillis) { uses.append(use) }
        screenAt = nil
        unlockedAt = nil
      case .handheldCallStarted: if callAt == nil { callAt = change.timeMillis }
      case .handheldCallEnded:
        if let callAt { uses.append((callAt, change.timeMillis)) }
        callAt = nil
      }
    }
    if let unlockedAt { uses.append((unlockedAt, end)) }
    if let screenAt, let use = handheld(screenAt, end) { uses.append(use) }
    if let callAt { uses.append((callAt, end)) }

    var fast: [(Int64, Int64)] = []
    for index in 1..<fixes.count {
      let from = fixes[index - 1]
      let to = fixes[index]
      if to.timeMillis - from.timeMillis > Self.maxPhoneUseFixGapMillis { continue }
      if (from.speed ?? 0) >= Self.phoneUseSpeed && (to.speed ?? 0) >= Self.phoneUseSpeed { fast.append((from.timeMillis, to.timeMillis)) }
    }
    let mergedFast = Self.merge(fast)
    return Self.merge(uses.map { (max($0.0, start), min($0.1, end)) })
      .compactMap { use -> (Int64, Int64)? in
        let overlaps = mergedFast.compactMap { stretch -> (Int64, Int64)? in
          let overlap = (max(use.0, stretch.0), min(use.1, stretch.1))
          return overlap.0 < overlap.1 ? overlap : nil
        }
        guard let first = overlaps.first, let last = overlaps.last,
          overlaps.reduce(0, { $0 + $1.1 - $1.0 }) > Self.minPhoneUseMillis
        else { return nil }
        return (first.0, last.1)
      }
      .map { from, to in
        let position = fixes.last { $0.timeMillis <= from } ?? fixes[0]
        let inside = fixes.filter { $0.timeMillis >= from && $0.timeMillis <= to }.map { $0.speed ?? 0 }
        return DrivingEvent(
          type: .phoneUse,
          timeOffsetSeconds: Double(from - start) / 1_000,
          durationSeconds: min(Double(to - from) / 1_000, Self.maxDurationSeconds),
          latitude: position.latitude,
          longitude: position.longitude,
          peak: inside.max() ?? position.speed ?? 0,
          limit: nil
        )
      }
  }

  private func handheld(_ from: Int64, _ to: Int64) -> (Int64, Int64)? {
    let first = Self.floorSecond(from)
    guard let baseline = average((first - Self.handBaselineSeconds)...(first - 1)) else { return nil }
    var tiltedSince: Int64?
    for second in first..<max(first, Self.ceilSecond(to)) {
      guard let mean = seconds[second]?.mean, Self.angleDegrees(baseline, mean) >= Self.handTiltDegrees else {
        tiltedSince = nil
        continue
      }
      let since = tiltedSince ?? second
      tiltedSince = since
      if second - since + 1 >= Self.handTiltSeconds { return (max(since * 1_000, from), to) }
    }
    return nil
  }

  private func gravityBefore(_ second: Int64) -> [Double]? {
    average((second - Self.baselineSeconds - 1)...(second - 2))
  }

  private func average(_ range: ClosedRange<Int64>) -> [Double]? {
    let means = range.compactMap { seconds[$0]?.mean }
    if means.isEmpty { return nil }
    return (0..<3).map { axis in means.reduce(0) { $0 + $1[axis] } / Double(means.count) }
  }

  private func horizontalAt(_ second: Int64, _ gravity: [Double]) -> [Double]? {
    guard let mean = seconds[second]?.mean else { return nil }
    let size = Self.length(gravity)
    guard size > 0 else { return nil }
    let up = gravity.map { $0 / size }
    let linear = (0..<3).map { mean[$0] - gravity[$0] }
    let vertical = Self.dot(linear, up)
    return (0..<3).map { linear[$0] - vertical * up[$0] }
  }

  private static func floorSecond(_ timeMillis: Int64) -> Int64 {
    timeMillis >= 0 ? timeMillis / 1_000 : (timeMillis - 999) / 1_000
  }

  private static func ceilSecond(_ timeMillis: Int64) -> Int64 {
    floorSecond(timeMillis + 999)
  }

  private static func merge(_ intervals: [(Int64, Int64)]) -> [(Int64, Int64)] {
    var merged: [(Int64, Int64)] = []
    for interval in intervals.filter({ $0.0 < $0.1 }).sorted(by: { $0.0 < $1.0 }) {
      if let last = merged.last, interval.0 <= last.1 {
        merged[merged.count - 1] = (last.0, max(last.1, interval.1))
      } else {
        merged.append(interval)
      }
    }
    return merged
  }

  private static func dot(_ a: [Double], _ b: [Double]) -> Double {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  }

  private static func length(_ a: [Double]) -> Double {
    dot(a, a).squareRoot()
  }

  private static func angleDegrees(_ a: [Double], _ b: [Double]) -> Double {
    let lengths = length(a) * length(b)
    if lengths == 0 { return 180 }
    return acos(min(max(dot(a, b) / lengths, -1), 1)) * 180 / .pi
  }
}
