import UIKit
import UserNotifications

enum NoticeSlot: String {
  case compatibility
  case sharingChanged
  case locationPermission
  case signedOut
}

enum Notice: String {
  case appTooOld
  case serverTooOld
  case selfHostedServerTooOld
  case outOfSync
  case locationPermission
  case deviceRemoved
  case signedOut
  case sharingResumed
  case sharingChanged

  var slot: NoticeSlot {
    switch self {
    case .appTooOld, .serverTooOld, .selfHostedServerTooOld, .outOfSync: return .compatibility
    case .locationPermission: return .locationPermission
    case .deviceRemoved, .signedOut: return .signedOut
    case .sharingResumed, .sharingChanged: return .sharingChanged
    }
  }

  var title: String {
    switch self {
    case .appTooOld: return "Update Open Beacon"
    case .serverTooOld, .selfHostedServerTooOld, .outOfSync: return "Location sharing paused"
    case .locationPermission: return "Location sharing stopped"
    case .deviceRemoved, .signedOut: return "Signed out of Open Beacon"
    case .sharingResumed: return "Location sharing turned back on"
    case .sharingChanged: return "Location sharing changed"
    }
  }

  var body: String {
    switch self {
    case .appTooOld: return "This phone has stopped sharing your location. Update the app to start sharing again."
    case .serverTooOld: return "We're updating Open Beacon's servers. Sharing will start again shortly."
    case .selfHostedServerTooOld: return "Your server needs updating before this phone can share its location again."
    case .outOfSync: return "The app and your server don't match. Open the app for details."
    case .locationPermission: return "Open Beacon can no longer use your location all the time. Tap to turn it back on."
    case .deviceRemoved: return "This phone was removed from your account and has stopped sharing your location."
    case .signedOut: return "This phone has stopped sharing your location. Sign in again to keep sharing."
    case .sharingResumed: return "You turned sharing on from another device. Tap to start sharing from this phone."
    case .sharingChanged: return "Sharing was changed from another device. Tap to update this phone."
    }
  }

  var link: String? {
    self == .locationPermission ? "openbeacon:///account/overview" : nil
  }
}

final class Notices: NSObject, UNUserNotificationCenterDelegate {
  static let shared = Notices()

  private static let center = UNUserNotificationCenter.current()
  private static let alertedKey = "openbeacon_notices.locationPermission"

  static func authorizationStatus() -> UNAuthorizationStatus {
    let semaphore = DispatchSemaphore(value: 0)
    var status = UNAuthorizationStatus.notDetermined
    center.getNotificationSettings { settings in
      status = settings.authorizationStatus
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 2)
    return status
  }

  static func areEnabled() -> Bool {
    [.authorized, .provisional, .ephemeral].contains(authorizationStatus())
  }

  static func requestPermission(_ completion: @escaping (String) -> Void) {
    switch authorizationStatus() {
    case .notDetermined:
      center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
        completion(granted ? "granted" : "denied")
      }
    case .denied:
      completion("blocked")
    default:
      completion("granted")
    }
  }

  static func show(_ notice: Notice) -> Bool {
    if !areEnabled() { return false }
    let defaults = UserDefaults.standard
    if notice == .locationPermission && defaults.bool(forKey: alertedKey) { return true }
    let content = UNMutableNotificationContent()
    content.title = notice.title
    content.body = notice.body
    content.sound = .default
    if let link = notice.link { content.userInfo = ["link": link] }
    center.add(UNNotificationRequest(identifier: identifier(notice.slot), content: content, trigger: nil))
    if notice == .locationPermission { defaults.set(true, forKey: alertedKey) }
    return true
  }

  static func showEvent(kind: String, key: String, title: String, body: String?, groupName: String?, link: String) -> Bool {
    let tags = [
      "alert": "openbeacon_place_alert",
      "placesChanged": "openbeacon_places_changed",
      "groupActivity": "openbeacon_group_activity",
      "accountAlert": "openbeacon_account_alert",
    ]
    guard let tag = tags[kind] else { return false }
    if !areEnabled() { return false }
    let content = UNMutableNotificationContent()
    content.title = title
    if let groupName { content.subtitle = groupName }
    if let body { content.body = body }
    content.threadIdentifier = tag
    content.userInfo = ["link": link]
    if kind != "placesChanged" { content.sound = .default }
    center.add(UNNotificationRequest(identifier: "\(tag).\(key)", content: content, trigger: nil))
    return true
  }

  static func dismiss(_ slot: NoticeSlot) {
    center.removeDeliveredNotifications(withIdentifiers: [identifier(slot)])
    if slot == .locationPermission { UserDefaults.standard.removeObject(forKey: alertedKey) }
  }

  private static func identifier(_ slot: NoticeSlot) -> String {
    "openbeacon_notice.\(slot.rawValue)"
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let link = response.notification.request.content.userInfo["link"] as? String, let url = URL(string: link) {
      DispatchQueue.main.async { UIApplication.shared.open(url) }
    }
    completionHandler()
  }
}
