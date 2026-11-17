import Foundation

struct SharingCaptureState: Equatable {
  var revisionPrefix = ""
  var paused = false
  var pausedUntil: Int64? = nil
  var resumeAfter: Int64 = 0

  func isPaused(now: Int64) -> Bool {
    paused && (pausedUntil.map { $0 > now } ?? true)
  }

  var isConfirmedIndefinitePause: Bool {
    paused && pausedUntil == nil && !revisionPrefix.isEmpty
  }

  func canCapture(timestamp: Int64, now: Int64) -> Bool {
    !isPaused(now: now) && timestamp > resumeAfter
  }

  func isAtLeastAsRecentAs(_ current: SharingCaptureState) -> Bool {
    let revision = Self.revisionParts(revisionPrefix)
    let previous = Self.revisionParts(current.revisionPrefix)
    return (0...1).allSatisfy { index in
      (index < revision.count ? revision[index] : 0) >= (index < previous.count ? previous[index] : 0)
    }
  }

  func canReplace(_ current: SharingCaptureState, confirmedRevision: String) -> Bool {
    (revisionPrefix.isEmpty && paused)
      || (isAtLeastAsRecentAs(current) && isAtLeastAsRecentAs(SharingCaptureState(revisionPrefix: confirmedRevision)))
  }

  private static func revisionParts(_ prefix: String) -> [Int64] {
    var trimmed = Substring(prefix)
    if trimmed.hasPrefix("s") { trimmed = trimmed.dropFirst() }
    if trimmed.hasSuffix(":") { trimmed = trimmed.dropLast() }
    return trimmed.split(separator: ".", omittingEmptySubsequences: false).map { Int64($0) ?? 0 }
  }
}

final class CaptureCommandState {
  private let lock = NSLock()
  private var generation: Int64 = 0

  func start() -> Int64 {
    lock.lock()
    defer { lock.unlock() }
    generation += 1
    return generation
  }

  func stop() {
    lock.lock()
    defer { lock.unlock() }
    generation += 1
  }

  func current() -> Int64 {
    lock.lock()
    defer { lock.unlock() }
    return generation
  }

  func isCurrent(_ command: Int64) -> Bool {
    current() == command
  }
}

struct CaptureRefreshState {
  private var requested: Int64 = 0
  private var completed: Int64 = 0

  mutating func request() {
    requested += 1
  }

  var pending: Int64? {
    requested > completed ? requested : nil
  }

  mutating func complete(_ generation: Int64) {
    completed = max(completed, generation)
  }

  mutating func clear() {
    completed = requested
  }
}

struct BatterySnapshot {
  let level: Int
  let charging: Bool
  let powerSaveMode: Bool
  let levelKnown: Bool
}

enum CaptureSamplingPolicy {
  static let defaultIntervalMs: Int64 = 30_000
  static let movingIntervalMs: Int64 = 10_000
  static let batterySaverDefaultIntervalMs: Int64 = 60_000
  static let batterySaverMovingIntervalMs: Int64 = 20_000
  static let uploadIntervalMs: Int64 = 60_000
  static let batterySaverUploadIntervalMs: Int64 = 120_000
  static let movingSpeedMps = 1.0
  static let stationaryDistanceMeters = 25.0
  static let maxStationarySkipMs: Int64 = 300_000
  static let lowBatteryLevel = 15

  static func evaluate(
    battery: BatterySnapshot,
    speedMetersPerSecond: Double?,
    distanceFromLastQueuedMeters: Double?,
    timeSinceLastQueuedMs: Int64?,
    forcedRefresh: Bool = false
  ) -> (shouldQueue: Bool, intervalMs: Int64, forceUpload: Bool, uploadIntervalMs: Int64) {
    let batterySaver = battery.powerSaveMode || (battery.levelKnown && battery.level <= lowBatteryLevel && !battery.charging)
    let moving = speedMetersPerSecond.map { $0 >= movingSpeedMps } ?? false
    let intervalMs: Int64 =
      batterySaver
        ? (moving ? batterySaverMovingIntervalMs : batterySaverDefaultIntervalMs)
        : (moving ? movingIntervalMs : defaultIntervalMs)

    let shouldQueue: Bool = {
      if forcedRefresh { return true }
      guard let distance = distanceFromLastQueuedMeters, let elapsed = timeSinceLastQueuedMs else { return true }
      return elapsed >= maxStationarySkipMs || moving || distance >= stationaryDistanceMeters
    }()

    return (
      shouldQueue: shouldQueue,
      intervalMs: intervalMs,
      forceUpload: forcedRefresh,
      uploadIntervalMs: batterySaver ? batterySaverUploadIntervalMs : uploadIntervalMs
    )
  }
}

struct PlaceGeofence: Equatable {
  let groupId: String
  let placeId: String
  let latitude: Double
  let longitude: Double
  let radiusMeters: Double
}

struct PlaceCrossing: Equatable {
  let place: PlaceGeofence
  let arrived: Bool
  let occurredAt: Int64
}

final class PlaceDwellDetector {
  static let dwellMs: Int64 = 120_000
  static let boundaryMarginMeters = 30.0
  static let maxAccuracyMeters = 200.0
  private static let earthRadiusMeters = 6_371_008.8

  private struct DwellState {
    let place: PlaceGeofence
    var inside: Bool? = nil
    var candidateInside: Bool? = nil
    var candidateSince: Int64 = 0
    var lastFixAt: Int64 = .min
  }

  private var states: [String: DwellState] = [:]

  func onFix(
    places: [PlaceGeofence],
    latitude: Double,
    longitude: Double,
    accuracyMeters: Double?,
    timestampMillis: Int64
  ) -> [PlaceCrossing] {
    let placeIds = Set(places.map(\.placeId))
    states = states.filter { placeIds.contains($0.key) }
    if let accuracyMeters, accuracyMeters > Self.maxAccuracyMeters { return [] }
    var crossings: [PlaceCrossing] = []
    for place in places {
      let existing = states[place.placeId]
      var next = existing?.place == place ? existing! : DwellState(place: place)
      if timestampMillis <= next.lastFixAt { continue }
      let distance = Self.distanceMeters(place.latitude, place.longitude, latitude, longitude)
      let observedInside: Bool? =
        distance <= place.radiusMeters ? true : distance > place.radiusMeters + Self.boundaryMarginMeters ? false : nil
      if let observedInside {
        if next.inside == nil {
          next.inside = observedInside
          next.candidateInside = nil
        } else if observedInside == next.inside {
          next.candidateInside = nil
        } else if next.candidateInside != observedInside {
          next.candidateInside = observedInside
          next.candidateSince = timestampMillis
        } else if timestampMillis - next.candidateSince >= Self.dwellMs {
          crossings.append(PlaceCrossing(place: place, arrived: observedInside, occurredAt: next.candidateSince))
          next.inside = observedInside
          next.candidateInside = nil
        }
      }
      next.lastFixAt = timestampMillis
      states[place.placeId] = next
    }
    return crossings
  }

  func reset() {
    states.removeAll()
  }

  static func distanceMeters(_ fromLatitude: Double, _ fromLongitude: Double, _ toLatitude: Double, _ toLongitude: Double) -> Double {
    let radians = { (degrees: Double) in degrees * .pi / 180 }
    let deltaLatitude = radians(toLatitude - fromLatitude)
    let deltaLongitude = radians(toLongitude - fromLongitude)
    let a =
      sin(deltaLatitude / 2) * sin(deltaLatitude / 2) +
      cos(radians(fromLatitude)) * cos(radians(toLatitude)) * sin(deltaLongitude / 2) * sin(deltaLongitude / 2)
    return 2 * earthRadiusMeters * asin(min(1.0, a.squareRoot()))
  }
}
