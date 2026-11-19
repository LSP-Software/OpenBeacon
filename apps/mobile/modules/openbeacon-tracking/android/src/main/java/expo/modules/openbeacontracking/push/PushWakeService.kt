package expo.modules.openbeacontracking.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.capture.TrackingUploadService

class PushWakeService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    when (message.data["t"]) {
      "sync" -> TrackingUploadService.start(applicationContext, TrackingUploadService.REASON_PUSH)
      "locate" -> TrackingCaptureService.locateNow(applicationContext)
    }
  }

  override fun onNewToken(token: String) {
    PushRuntime.receive(applicationContext, token)
  }
}
