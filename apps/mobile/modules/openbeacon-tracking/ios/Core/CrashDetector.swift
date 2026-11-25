import Foundation

struct CrashSuspicion: Equatable {
  var timeMillis: Int64
  var latitude: Double
  var longitude: Double
  var speedBefore: Double
}

final class CrashDetector {
  static let gateSpeed = 40 / 3.6
  static let spikeMagnitude = 4 * 9.80665
  static let gateAgeMillis: Int64 = 5_000
  static let batterySaverGateAgeMillis: Int64 = 25_000
  static let settleMillis: Int64 = 3_000
  static let stillSpeed = 2.0
  static let stillMillis: Int64 = 15_000
  static let giveUpMillis: Int64 = 60_000
  static let quietAfterMillis: Int64 = 300_000
  private static let keepFixesMillis: Int64 = 120_000

  private struct SeenFix {
    var fix: DriveFix
    var inDrive: Bool
  }

  private enum Outcome {
    case wait
    case drop
    case crash(CrashSuspicion)
  }

  private let isAlertOpen: () -> Bool
  private var fixes: [SeenFix] = []
  private var spikes: [Int64] = []
  private var quietUntilMillis = Int64.min
  private static let maxPendingSpikes = 32

  init(isAlertOpen: @escaping () -> Bool = { false }) {
    self.isAlertOpen = isAlertOpen
  }

  func onFix(_ fix: DriveFix, inDrive: Bool) -> CrashSuspicion? {
    guard let accuracy = fix.accuracy, accuracy <= DriveDetector.maxAccuracyMeters, fix.speed != nil else { return nil }
    if let last = fixes.last, fix.timeMillis <= last.fix.timeMillis { return nil }
    fixes.append(SeenFix(fix: fix, inDrive: inDrive))
    fixes.removeAll { fix.timeMillis - $0.fix.timeMillis > Self.keepFixesMillis }
    return evaluate()
  }

  func onMotion(timeMillis: Int64, magnitude: Double) -> CrashSuspicion? {
    guard magnitude >= Self.spikeMagnitude, timeMillis >= quietUntilMillis else { return nil }
    guard !spikes.contains(where: { abs($0 - timeMillis) <= Self.settleMillis }) else { return nil }
    spikes.append(timeMillis)
    spikes.sort()
    if spikes.count > Self.maxPendingSpikes { spikes.removeFirst() }
    return evaluate()
  }

  func reset() {
    fixes.removeAll()
    spikes.removeAll()
    quietUntilMillis = Int64.min
  }

  private func evaluate() -> CrashSuspicion? {
    guard let latest = fixes.last?.fix.timeMillis else { return nil }
    for spike in spikes where latest >= spike {
      switch judge(spike: spike, latest: latest) {
      case .wait:
        continue
      case .drop:
        spikes.removeAll { $0 == spike }
      case .crash(let suspicion):
        if isAlertOpen() {
          spikes.removeAll { $0 == spike }
          continue
        }
        spikes.removeAll()
        quietUntilMillis = spike + Self.quietAfterMillis
        return suspicion
      }
    }
    return nil
  }

  private func judge(spike: Int64, latest: Int64) -> Outcome {
    if spike < quietUntilMillis { return .drop }
    guard let gate = fixes.last(where: { $0.fix.timeMillis <= spike }) else { return .drop }
    let maxAge = gate.fix.batterySaver ? Self.batterySaverGateAgeMillis : Self.gateAgeMillis
    guard gate.inDrive, (gate.fix.speed ?? 0) >= Self.gateSpeed, spike - gate.fix.timeMillis <= maxAge else { return .drop }
    let after = fixes.filter { $0.fix.timeMillis > spike + Self.settleMillis }
    if after.contains(where: { ($0.fix.speed ?? 0) >= Self.stillSpeed }) { return .drop }
    guard let confirming = after.first(where: { $0.fix.timeMillis >= spike + Self.stillMillis }) else {
      return latest > spike + Self.giveUpMillis ? .drop : .wait
    }
    if confirming.fix.timeMillis > spike + Self.giveUpMillis { return .drop }
    let spot = after[0].fix
    return .crash(CrashSuspicion(timeMillis: spike, latitude: spot.latitude, longitude: spot.longitude, speedBefore: gate.fix.speed ?? 0))
  }
}
