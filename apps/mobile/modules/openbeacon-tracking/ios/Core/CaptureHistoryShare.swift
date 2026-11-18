import Foundation

struct CaptureHistoryShare: Equatable {
  static let lastLocation = "LAST_LOCATION"
  static let maximum = "MAXIMUM"

  var account: String = CaptureHistoryShare.maximum
  var groups: [String: String] = [:]

  func isLiveOnly(_ groupId: String) -> Bool {
    (groups[groupId] ?? account) == CaptureHistoryShare.lastLocation
  }
}
