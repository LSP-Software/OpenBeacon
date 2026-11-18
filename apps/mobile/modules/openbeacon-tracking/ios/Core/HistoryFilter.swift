import Foundation

struct HistoryFilterSettings {
  var minToleranceMeters = 15.0
  var toleranceSecondsOfSpeed = 1.5
  var maxGapMeters = 600.0
  var shortestMaxGapMs: Int64 = 30_000
  var longestMaxGapMs: Int64 = 120_000
  var stayRadiusMeters = 50.0
  var stayAfterMs: Int64 = 180_000
  var stayUpdateMs: Int64 = 300_000
  var stayGapMs: Int64 = 600_000
  var maxAccuracyMeters = 200.0
  var dailyAllowance = 2_880
  var allowanceWindowMs: Int64 = 86_400_000
}

struct HistoryFix: Equatable {
  var latitude: Double
  var longitude: Double
  var timestampMillis: Int64
  var accuracyMeters: Double?
  var speedMetersPerSecond: Double?
  var batteryLevel: Int?
  var batteryCharging: Bool
}

struct HistoryRecord: Equatable {
  let fix: HistoryFix
  var stayUntil: Int64? = nil
}

struct HistoryAllowance: Equatable {
  var tokens: Double
  var updatedAt: Int64

  func refill(now: Int64, settings: HistoryFilterSettings) -> HistoryAllowance {
    let limit = Double(settings.dailyAllowance)
    return HistoryAllowance(
      tokens: min(limit, tokens + Double(max(0, now - updatedAt)) * limit / Double(settings.allowanceWindowMs)),
      updatedAt: now
    )
  }

  func take(now: Int64, settings: HistoryFilterSettings) -> HistoryAllowance? {
    var refilled = refill(now: now, settings: settings)
    guard refilled.tokens >= 1 else { return nil }
    refilled.tokens -= 1
    return refilled
  }

  static func full(now: Int64, settings: HistoryFilterSettings) -> HistoryAllowance {
    HistoryAllowance(tokens: Double(settings.dailyAllowance), updatedAt: now)
  }
}

final class HistoryFilter {
  private struct Stay {
    var arrival: HistoryFix?
    var latest: HistoryFix
    var latitudeSum: Double
    var longitudeSum: Double
    var count: Int
    var sentUntil: Int64?

    var latitude: Double { latitudeSum / Double(count) }
    var longitude: Double { longitudeSum / Double(count) }

    func record() -> HistoryRecord? {
      guard var fix = arrival else { return nil }
      fix.latitude = latitude
      fix.longitude = longitude
      fix.batteryLevel = latest.batteryLevel
      fix.batteryCharging = latest.batteryCharging
      return HistoryRecord(fix: fix, stayUntil: latest.timestampMillis)
    }
  }

  private let settings: HistoryFilterSettings
  private var lastTimestamp = Int64.min
  private var lastKept: HistoryFix?
  private var pending: [HistoryFix] = []
  private var still: [HistoryFix] = []
  private var stay: Stay?
  private var leaving: HistoryFix?

  init(settings: HistoryFilterSettings = HistoryFilterSettings()) {
    self.settings = settings
  }

  func onFix(_ fix: HistoryFix, takeAllowance: () -> Bool) -> [HistoryRecord] {
    if let accuracy = fix.accuracyMeters, accuracy > settings.maxAccuracyMeters { return [] }
    if fix.timestampMillis <= lastTimestamp {
      if lastTimestamp - fix.timestampMillis <= settings.stayGapMs { return [] }
      stay = nil
      leaving = nil
      lastKept = nil
      pending.removeAll()
      still.removeAll()
    }
    lastTimestamp = fix.timestampMillis

    guard let current = stay else { return onMovingFix(fix, takeAllowance: takeAllowance) }
    let distance = PlaceDwellDetector.distanceMeters(current.latitude, current.longitude, fix.latitude, fix.longitude)
    let gap = fix.timestampMillis - current.latest.timestampMillis > settings.stayGapMs
    if !gap && distance - (fix.accuracyMeters ?? 0) <= settings.stayRadiusMeters {
      leaving = nil
      let hourStart = fix.timestampMillis - ((fix.timestampMillis % 3_600_000) + 3_600_000) % 3_600_000
      if var arrivedAt = current.arrival, arrivedAt.timestampMillis < hourStart {
        var closing = current.record()
        closing?.stayUntil = hourStart
        let closed = closing != nil && takeAllowance()
        arrivedAt.timestampMillis = hourStart
        var opened = Stay(
          arrival: arrivedAt,
          latest: fix,
          latitudeSum: current.latitudeSum + fix.latitude,
          longitudeSum: current.longitudeSum + fix.longitude,
          count: current.count + 1,
          sentUntil: nil
        )
        let closedRecords = closed ? [closing].compactMap { $0 } : []
        guard takeAllowance() else {
          stay = opened
          return closedRecords
        }
        opened.sentUntil = fix.timestampMillis
        stay = opened
        return closedRecords + [opened.record()].compactMap { $0 }
      }
      let arrival = current.arrival ?? fix
      var next = current
      next.arrival = arrival
      next.latest = fix
      next.latitudeSum += fix.latitude
      next.longitudeSum += fix.longitude
      next.count += 1
      let due = current.arrival == nil || fix.timestampMillis - (next.sentUntil ?? arrival.timestampMillis) >= settings.stayUpdateMs
      if due && takeAllowance() {
        next.sentUntil = fix.timestampMillis
        stay = next
        return next.record().map { [$0] } ?? []
      }
      stay = next
      return []
    }
    let firstOutside = leaving
    if !gap && firstOutside == nil {
      leaving = fix
      return []
    }
    let records = close(current, takeAllowance: takeAllowance)
    stay = nil
    leaving = nil
    if gap {
      lastKept = nil
    } else {
      var kept = current.latest
      kept.latitude = current.latitude
      kept.longitude = current.longitude
      lastKept = kept
    }
    pending.removeAll()
    still.removeAll()
    let departure = gap || firstOutside == nil ? [] : onMovingFix(firstOutside!, takeAllowance: takeAllowance)
    return records + departure + onMovingFix(fix, takeAllowance: takeAllowance)
  }

  func handOver(takeAllowance: () -> Bool) -> (HistoryFilter, [HistoryRecord]) {
    let next = HistoryFilter(settings: settings)
    next.lastTimestamp = lastTimestamp
    next.lastKept = lastKept
    guard let current = stay else { return (next, []) }
    var carried = current
    carried.arrival = nil
    carried.sentUntil = nil
    next.stay = carried
    return (next, close(current, takeAllowance: takeAllowance))
  }

  private func onMovingFix(_ fix: HistoryFix, takeAllowance: () -> Bool) -> [HistoryRecord] {
    let records = keepRoute(fix, takeAllowance: takeAllowance)
    if let anchor = still.first, let last = still.last,
      fix.timestampMillis - last.timestampMillis > settings.stayGapMs
        || PlaceDwellDetector.distanceMeters(anchor.latitude, anchor.longitude, fix.latitude, fix.longitude) - (fix.accuracyMeters ?? 0) > settings.stayRadiusMeters
    {
      still.removeAll()
    }
    still.append(fix)
    guard let first = still.first, fix.timestampMillis - first.timestampMillis >= settings.stayAfterMs else { return records }

    var arrived = Stay(
      arrival: first,
      latest: fix,
      latitudeSum: still.reduce(0) { $0 + $1.latitude },
      longitudeSum: still.reduce(0) { $0 + $1.longitude },
      count: still.count,
      sentUntil: nil
    )
    still.removeAll()
    pending.removeAll()
    lastKept = nil
    guard takeAllowance() else {
      stay = arrived
      return records
    }
    arrived.sentUntil = fix.timestampMillis
    stay = arrived
    return records + (arrived.record().map { [$0] } ?? [])
  }

  private func close(_ current: Stay, takeAllowance: () -> Bool) -> [HistoryRecord] {
    guard let record = current.record() else { return [] }
    return current.sentUntil != current.latest.timestampMillis && takeAllowance() ? [record] : []
  }

  private func keepRoute(_ fix: HistoryFix, takeAllowance: () -> Bool) -> [HistoryRecord] {
    guard let kept = lastKept else {
      guard takeAllowance() else { return [] }
      lastKept = fix
      pending.removeAll()
      return [HistoryRecord(fix: fix)]
    }
    var records: [HistoryRecord] = []
    var start = kept
    if let previous = pending.last, pending.contains(where: { routeError(from: kept, to: fix, actual: $0) > tolerance($0) }) {
      guard takeAllowance() else {
        dropRoute()
        return []
      }
      records.append(HistoryRecord(fix: previous))
      lastKept = previous
      pending.removeAll()
      start = previous
    }
    if fix.timestampMillis - start.timestampMillis < maxGapMs(fix) {
      pending.append(fix)
      return records
    }
    guard takeAllowance() else {
      dropRoute()
      return records
    }
    lastKept = fix
    pending.removeAll()
    return records + [HistoryRecord(fix: fix)]
  }

  private func dropRoute() {
    lastKept = nil
    pending.removeAll()
  }

  private func routeError(from: HistoryFix, to: HistoryFix, actual: HistoryFix) -> Double {
    let fraction = Double(actual.timestampMillis - from.timestampMillis) / Double(to.timestampMillis - from.timestampMillis)
    return PlaceDwellDetector.distanceMeters(
      from.latitude + (to.latitude - from.latitude) * fraction,
      from.longitude + (to.longitude - from.longitude) * fraction,
      actual.latitude,
      actual.longitude
    )
  }

  private func tolerance(_ fix: HistoryFix) -> Double {
    max(settings.minToleranceMeters, settings.toleranceSecondsOfSpeed * (fix.speedMetersPerSecond ?? 0))
  }

  private func maxGapMs(_ fix: HistoryFix) -> Int64 {
    guard let speed = fix.speedMetersPerSecond, speed > 0 else { return settings.longestMaxGapMs }
    return min(max(Int64(settings.maxGapMeters / speed * 1_000), settings.shortestMaxGapMs), settings.longestMaxGapMs)
  }
}
