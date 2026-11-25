import Foundation

struct DriveFix: Equatable {
  var timeMillis: Int64
  var latitude: Double
  var longitude: Double
  var speed: Double?
  var accuracy: Double?
  var batterySaver: Bool
}

struct DetectedDrive: Equatable {
  var start: DrivePosition
  var end: DrivePosition
  var distanceMeters: Double
  var checkedDistanceMeters: Double
  var durationSeconds: Double
  var topSpeed: Double
  var averageSpeed: Double
  var fixes: [DriveFix] = []
}

struct DriveStep {
  var started: Bool
  var finished: DetectedDrive?
}

final class DriveDetector {
  static let drivingSpeed = 7.0
  static let confirmFixes = 3
  static let movingSpeed = 0.5
  static let walkingSpeed = 2.2
  static let walkAwayMeters = 25.0
  static let walkAwayMillis: Int64 = 20_000
  static let endAfterMillis: Int64 = 300_000
  static let minDistanceMeters = 1_000.0
  static let minDurationSeconds = 120.0
  static let maxSpeed = 200 / 3.6
  static let maxSpeedSustainedMillis: Int64 = 30_000
  static let maxAccuracyMeters = 20.0
  static let backDateLimitMillis: Int64 = 600_000
  private static let maxDerivedSpeedGapSeconds = 60.0
  private static let earthRadiusMeters = 6_371_008.8

  private struct Candidate {
    var run: Int
    var after: Int
  }

  private var stretch: [DriveFix] = []
  private var previous: DriveFix?
  private var candidate: Candidate?
  private var lastDrivingMillis: Int64 = 0
  private var lastMovingIndex = -1
  private var stop: DriveFix?
  private var walkingSince: Int64?

  private(set) var recording = false

  var wantsFastFixes: Bool {
    (recording || candidate != nil) && previous?.batterySaver == false
  }

  var retainedFixes: [DriveFix] {
    if let previous, previous != stretch.last { return stretch + [previous] }
    return stretch
  }

  func onFix(_ fix: DriveFix) -> DriveStep {
    guard let accuracy = fix.accuracy, accuracy <= Self.maxAccuracyMeters, fix.latitude.isFinite, fix.longitude.isFinite else {
      return DriveStep(started: false, finished: nil)
    }
    let last = previous
    if let last, fix.timeMillis <= last.timeMillis { return DriveStep(started: false, finished: nil) }
    let reported = fix.speed.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
    let speed = reported ?? last.flatMap { last -> Double? in
      let seconds = Double(fix.timeMillis - last.timeMillis) / 1_000
      return seconds <= Self.maxDerivedSpeedGapSeconds ? Self.distanceMeters(last, fix) / seconds : nil
    }
    var resolved = fix
    resolved.speed = speed
    previous = resolved

    let finished = recording && fix.timeMillis - lastDrivingMillis >= Self.endAfterMillis ? finish() : nil
    if !recording, let last, fix.timeMillis - last.timeMillis >= Self.endAfterMillis { reset() }
    guard let speed else { return DriveStep(started: false, finished: finished) }

    if recording {
      stretch.append(resolved)
      if speed >= Self.drivingSpeed {
        lastDrivingMillis = fix.timeMillis
        lastMovingIndex = stretch.count - 1
        stop = nil
        walkingSince = nil
      } else if speed < Self.movingSpeed {
        if stop == nil { stop = fix }
        walkingSince = nil
      } else if speed > Self.walkingSpeed {
        lastMovingIndex = stretch.count - 1
        stop = nil
        walkingSince = nil
      } else if let stoppedAt = stop {
        let since = walkingSince ?? fix.timeMillis
        walkingSince = since
        if Self.distanceMeters(stoppedAt, fix) >= Self.walkAwayMeters || fix.timeMillis - since >= Self.walkAwayMillis {
          return DriveStep(started: false, finished: finished ?? finish())
        }
      } else {
        lastMovingIndex = stretch.count - 1
      }
      return DriveStep(started: false, finished: finished)
    }

    if speed < Self.movingSpeed {
      stretch.removeAll()
      candidate = nil
      return DriveStep(started: false, finished: finished)
    }
    stretch.append(resolved)
    stretch.removeAll { fix.timeMillis - $0.timeMillis > Self.backDateLimitMillis }
    let driving = speed >= Self.drivingSpeed
    if let current = candidate {
      let run = driving ? current.run + 1 : 0
      if run >= Self.confirmFixes {
        candidate = Candidate(run: run, after: current.after + 1)
      } else if current.after + 1 >= Self.confirmFixes {
        candidate = driving ? Candidate(run: run, after: 0) : nil
      } else {
        candidate = Candidate(run: run, after: current.after + 1)
      }
    } else {
      candidate = driving ? Candidate(run: 1, after: 0) : nil
    }
    guard (candidate?.run ?? 0) >= Self.confirmFixes else { return DriveStep(started: false, finished: finished) }
    candidate = nil
    recording = true
    lastDrivingMillis = fix.timeMillis
    lastMovingIndex = stretch.count - 1
    return DriveStep(started: true, finished: finished)
  }

  func onPlaceArrive() -> DetectedDrive? {
    recording ? finish() : nil
  }

  func interrupt() -> DetectedDrive? {
    let drive = recording ? finish() : nil
    reset()
    return drive
  }

  func discard() {
    reset()
  }

  private func reset() {
    stretch.removeAll()
    candidate = nil
    recording = false
    lastMovingIndex = -1
    stop = nil
    walkingSince = nil
  }

  private func finish() -> DetectedDrive? {
    let fixes = Array(stretch.prefix(lastMovingIndex + 1))
    reset()
    guard fixes.count >= 2, let first = fixes.first, let last = fixes.last else { return nil }
    var distance = 0.0
    var checked = 0.0
    var fastSince: Int64?
    for (index, fix) in fixes.enumerated() {
      if (fix.speed ?? 0) > Self.maxSpeed {
        let since = fastSince ?? fix.timeMillis
        fastSince = since
        if fix.timeMillis - since >= Self.maxSpeedSustainedMillis { return nil }
      } else {
        fastSince = nil
      }
      if index == 0 { continue }
      let before = fixes[index - 1]
      let step = Self.distanceMeters(before, fix)
      distance += step
      if !before.batterySaver && !fix.batterySaver { checked += step }
    }
    let duration = Double(last.timeMillis - first.timeMillis) / 1_000
    guard distance >= Self.minDistanceMeters, duration >= Self.minDurationSeconds else { return nil }
    return DetectedDrive(
      start: DrivePosition(timeMillis: first.timeMillis, latitude: first.latitude, longitude: first.longitude),
      end: DrivePosition(timeMillis: last.timeMillis, latitude: last.latitude, longitude: last.longitude),
      distanceMeters: distance,
      checkedDistanceMeters: checked,
      durationSeconds: duration,
      topSpeed: fixes.map { $0.speed ?? 0 }.max() ?? 0,
      averageSpeed: distance / duration,
      fixes: fixes
    )
  }

  private static func distanceMeters(_ from: DriveFix, _ to: DriveFix) -> Double {
    let fromLatitude = from.latitude * .pi / 180
    let toLatitude = to.latitude * .pi / 180
    let a = pow(sin((toLatitude - fromLatitude) / 2), 2)
      + cos(fromLatitude) * cos(toLatitude) * pow(sin((to.longitude - from.longitude) * .pi / 180 / 2), 2)
    return 2 * earthRadiusMeters * asin(sqrt(min(max(a, 0), 1)))
  }
}
