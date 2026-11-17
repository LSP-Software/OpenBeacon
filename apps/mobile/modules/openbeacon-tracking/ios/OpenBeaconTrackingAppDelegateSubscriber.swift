import ExpoModulesCore
import UserNotifications

public class OpenBeaconTrackingAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    do {
      try KeychainItem.removeLeftoversFromPreviousInstall()
    } catch {
      NSLog("OpenBeaconTracking: failed to remove Keychain items left by a previous install, retrying on next use: \(error)")
    }
    UNUserNotificationCenter.current().delegate = Notices.shared
    TrackingRuntime.registerParkedCheck()
    _ = LocationCapture.shared
    TrackingRuntime.restoreOnLaunch()
    return true
  }
}
