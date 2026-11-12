package expo.modules.openbeacontracking.capture

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class TrackingUploadService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      "OpenBeaconTrackingUpload",
      Arguments.createMap().apply { putString("reason", intent?.getStringExtra(EXTRA_REASON) ?: "upload") },
      60_000,
      true,
    )

  companion object {
    const val EXTRA_REASON = "reason"
  }
}
