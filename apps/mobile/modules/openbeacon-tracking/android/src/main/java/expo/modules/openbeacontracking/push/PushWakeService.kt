package expo.modules.openbeacontracking.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.capture.TrackingUploadService

class PushWakeService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val kind = message.data["t"]
    when (kind) {
      "sync" -> TrackingUploadService.start(applicationContext, TrackingUploadService.REASON_PUSH)
      "locate" -> TrackingCaptureService.locateNow(applicationContext)
      else -> return
    }
    PushRuntime.recordWake(applicationContext, kind)
  }

  override fun onNewToken(token: String) {
    PushRuntime.receive(applicationContext, token)
  }
}
