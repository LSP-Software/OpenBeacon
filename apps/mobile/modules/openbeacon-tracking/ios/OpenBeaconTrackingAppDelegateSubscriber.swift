import ExpoModulesCore
import UserNotifications

public class OpenBeaconTrackingAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    KeychainItem.removeLeftoversFromPreviousInstall()
    UNUserNotificationCenter.current().delegate = Notices.shared
    TrackingRuntime.registerParkedCheck()
    _ = LocationCapture.shared
    TrackingRuntime.restoreOnLaunch()
    return true
  }
}
