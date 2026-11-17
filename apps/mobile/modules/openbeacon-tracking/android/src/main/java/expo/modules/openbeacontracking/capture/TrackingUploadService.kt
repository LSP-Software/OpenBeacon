package expo.modules.openbeacontracking.capture

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class TrackingUploadService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!wakes.accept(intent?.getStringExtra(EXTRA_REASON) == REASON_PUSH)) return START_NOT_STICKY
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      "OpenBeaconTrackingUpload",
      Arguments.createMap().apply { putString("reason", intent?.getStringExtra(EXTRA_REASON) ?: "upload") },
      60_000,
      true,
    )

  override fun onHeadlessJsTaskStart(taskId: Int) {
    wakes.started(taskId)
    super.onHeadlessJsTaskStart(taskId)
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    val followUp = wakes.finished(taskId)
    super.onHeadlessJsTaskFinish(taskId)
    if (followUp) startFollowUp()
  }

  override fun onDestroy() {
    super.onDestroy()
    if (wakes.stopped()) startFollowUp()
  }

  private fun startFollowUp() {
    val context = applicationContext
    Handler(Looper.getMainLooper()).post { start(context, REASON_PUSH) }
  }

  companion object {
    const val EXTRA_REASON = "reason"
    const val REASON_PUSH = "push"
    private val wakes = UploadWakeGate()

    fun start(context: Context, reason: String) {
      try {
        context.startService(Intent(context, TrackingUploadService::class.java).putExtra(EXTRA_REASON, reason))
      } catch (error: IllegalStateException) {
        Log.w("TrackingUploadService", "Android didn't allow the upload to start in the background.", error)
      }
    }
  }
}
